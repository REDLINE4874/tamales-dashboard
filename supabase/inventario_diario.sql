-- Inventario diario y apertura/cierre de pedidos web.
-- Ejecutar despues de tamales.sql y pedidos_publicos.sql. Reejecutable.

ALTER TABLE semana_activa
  ADD COLUMN IF NOT EXISTS fecha_operativa date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Mexico_City')::date,
  ADD COLUMN IF NOT EXISTS pedidos_abiertos boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tamales_abiertos boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bebidas_abiertas boolean NOT NULL DEFAULT false;
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS fecha_operativa date;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_operativa date;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'panel';
ALTER TABLE pedido_apartados ADD COLUMN IF NOT EXISTS fecha_operativa date;
ALTER TABLE pedido_apartados ADD COLUMN IF NOT EXISTS pedido_folio text;
ALTER TABLE pedido_apartados ADD COLUMN IF NOT EXISTS telefono_cliente text;
ALTER TABLE pedido_apartados ADD COLUMN IF NOT EXISTS motivo_cancelacion text;
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS cerrado boolean NOT NULL DEFAULT false;
ALTER TABLE inventario DROP CONSTRAINT IF EXISTS inventario_semana_tipo_key;
ALTER TABLE pedido_apartados DROP CONSTRAINT IF EXISTS pedido_apartados_pedido_id_fkey;
ALTER TABLE pedido_apartados ADD CONSTRAINT pedido_apartados_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL;

-- Corre una sola vez: la migración previa pudo fechar como "hoy" cantidades
-- semanales antiguas de tamales. Las conserva, pero las cierra para que no
-- se presenten como el inventario diario actual. Al guardar el stock real,
-- el upsert de guardar_inventario_diario las reabre con las cantidades nuevas.
CREATE TABLE IF NOT EXISTS inventario_migraciones (
  codigo text PRIMARY KEY,
  aplicado_en timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inventario_migraciones WHERE codigo='cerrar_stock_tamal_semanal_marcado_como_hoy') THEN
    UPDATE inventario i SET cerrado=true
    WHERE i.fecha_operativa=(now() AT TIME ZONE 'America/Mexico_City')::date
      AND EXISTS (
        SELECT 1 FROM config c, jsonb_array_elements(coalesce(c.tipos,'[]'::jsonb)) t
        WHERE t->>'tipo'=i.tipo
      );
    INSERT INTO inventario_migraciones(codigo) VALUES('cerrar_stock_tamal_semanal_marcado_como_hoy');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cancelaciones_pedido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio text NOT NULL,
  telefono text NOT NULL,
  motivo text NOT NULL,
  detalle jsonb NOT NULL DEFAULT '[]'::jsonb,
  cantidad_total integer NOT NULL DEFAULT 0,
  monto_esperado numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cancelaciones_pedido ADD COLUMN IF NOT EXISTS detalle jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cancelaciones_pedido ADD COLUMN IF NOT EXISTS cantidad_total integer NOT NULL DEFAULT 0;
ALTER TABLE cancelaciones_pedido ADD COLUMN IF NOT EXISTS monto_esperado numeric NOT NULL DEFAULT 0;
ALTER TABLE cancelaciones_pedido ENABLE ROW LEVEL SECURITY;

UPDATE pedidos SET fecha_operativa = (created_at AT TIME ZONE 'America/Mexico_City')::date WHERE fecha_operativa IS NULL;
UPDATE pedidos SET origen='cliente' WHERE telefono IS NOT NULL AND origen='panel';
UPDATE pedido_apartados SET fecha_operativa = (created_at AT TIME ZONE 'America/Mexico_City')::date WHERE fecha_operativa IS NULL;
UPDATE semana_activa SET tamales_abiertos=pedidos_abiertos,bebidas_abiertas=pedidos_abiertos WHERE pedidos_abiertos AND NOT tamales_abiertos AND NOT bebidas_abiertas;
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_operativa ON pedidos (fecha_operativa);
CREATE INDEX IF NOT EXISTS idx_apartados_fecha_activos ON pedido_apartados (fecha_operativa, vence_en) WHERE estado = 'Activo';
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventario_fecha_tipo ON inventario (fecha_operativa, tipo) WHERE fecha_operativa IS NOT NULL;

CREATE OR REPLACE FUNCTION menu_publico()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_semana text;
  v_fecha date;
  v_hoy date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_tamales_abiertos boolean := false;
  v_bebidas_abiertas boolean := false;
  v_tipos jsonb;
  v_bebidas jsonb;
  v_tipos_resultado jsonb := '[]'::jsonb;
  v_bebidas_resultado jsonb := '[]'::jsonb;
  v_item jsonb;
  v_tipo text;
  v_inicial integer;
  v_inventario_registrado boolean;
  v_pedidos integer;
  v_apartados integer;
BEGIN
  SELECT semana, fecha_operativa, tamales_abiertos, bebidas_abiertas INTO v_semana, v_fecha, v_tamales_abiertos, v_bebidas_abiertas FROM semana_activa WHERE id = 1;
  IF v_fecha IS NULL OR v_fecha<>v_hoy THEN v_fecha:=v_hoy;v_tamales_abiertos:=false;v_bebidas_abiertas:=false; END IF;
  v_tamales_abiertos:=coalesce(v_tamales_abiertos,false) AND v_fecha=v_hoy;
  v_bebidas_abiertas:=coalesce(v_bebidas_abiertas,false) AND v_fecha=v_hoy;
  SELECT tipos, bebidas INTO v_tipos, v_bebidas FROM config ORDER BY updated_at DESC, id DESC LIMIT 1;
  FOR v_item IN
    SELECT value || jsonb_build_object('categoria', 'tamal') FROM jsonb_array_elements(coalesce(v_tipos, '[]'::jsonb)) WHERE v_tamales_abiertos
    UNION ALL
    SELECT value || jsonb_build_object('categoria', 'bebida') FROM jsonb_array_elements(coalesce(v_bebidas, '[]'::jsonb))
      WHERE v_bebidas_abiertas AND coalesce((value->>'activo')::boolean, false)
  LOOP
    v_tipo := v_item->>'tipo';
    SELECT coalesce(cantidad_inicial, 0) INTO v_inicial FROM inventario WHERE fecha_operativa = v_fecha AND tipo = v_tipo AND NOT cerrado;
    v_inventario_registrado := FOUND;
    v_inicial := coalesce(v_inicial, 0);
    SELECT coalesce(sum((d->>'cantidad')::int), 0) INTO v_pedidos
      FROM pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.detalle) d
      WHERE p.fecha_operativa = v_fecha AND d->>'tipo' = v_tipo;
    SELECT coalesce(sum((d->>'cantidad')::int), 0) INTO v_apartados
      FROM pedido_apartados a CROSS JOIN LATERAL jsonb_array_elements(a.detalle) d
      WHERE a.fecha_operativa = v_fecha AND a.estado = 'Activo' AND a.vence_en > now() AND d->>'tipo' = v_tipo;
    IF v_item->>'categoria' = 'bebida' THEN
      v_bebidas_resultado := v_bebidas_resultado || jsonb_build_array(jsonb_build_object('tipo', v_tipo, 'precio', (v_item->>'precio')::numeric, 'disponible', greatest(v_inicial-v_pedidos-v_apartados,0), 'inventario_hoy', v_inventario_registrado));
    ELSE
      v_tipos_resultado := v_tipos_resultado || jsonb_build_array(jsonb_build_object('tipo', v_tipo, 'precio', (v_item->>'precio')::numeric, 'disponible', greatest(v_inicial-v_pedidos-v_apartados,0), 'inventario_hoy', v_inventario_registrado));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('semana', v_semana, 'fecha', v_fecha, 'abierto', (v_tamales_abiertos OR v_bebidas_abiertas), 'tamales_abiertos', v_tamales_abiertos, 'bebidas_abiertos', v_bebidas_abiertas, 'tipos', v_tipos_resultado, 'bebidas', v_bebidas_resultado);
END; $$;

CREATE OR REPLACE FUNCTION crear_apartado_publico(p_detalle jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_semana text;
  v_fecha date;
  v_tamales_abiertos boolean;
  v_bebidas_abiertas boolean;
  v_hoy date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_config jsonb;
  v_linea jsonb;
  v_tipo text;
  v_cantidad integer;
  v_disponible integer;
  v_precio numeric;
  v_id uuid;
  v_normalizado jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(94713281);
  UPDATE pedido_apartados SET estado = 'Expirado' WHERE estado = 'Activo' AND vence_en <= now();
  IF coalesce(jsonb_typeof(p_detalle), '') <> 'array' OR jsonb_array_length(p_detalle) = 0 THEN RAISE EXCEPTION 'Agrega productos al pedido'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_detalle)) <> (SELECT count(DISTINCT value->>'tipo') FROM jsonb_array_elements(p_detalle)) THEN RAISE EXCEPTION 'Combina cantidades del mismo producto'; END IF;
  SELECT semana, fecha_operativa, tamales_abiertos, bebidas_abiertas INTO v_semana, v_fecha, v_tamales_abiertos, v_bebidas_abiertas FROM semana_activa WHERE id=1;
  v_fecha := coalesce(v_fecha, v_hoy);
  IF v_fecha <> v_hoy THEN v_tamales_abiertos:=false;v_bebidas_abiertas:=false; END IF;
  IF auth.uid() IS NULL AND NOT (coalesce(v_tamales_abiertos,false) OR coalesce(v_bebidas_abiertas,false)) THEN RAISE EXCEPTION 'Los pedidos en linea estan cerrados'; END IF;
  IF v_semana IS NULL THEN v_semana := to_char(v_fecha,'YYYY-MM') || '-S' || ceil(extract(day FROM v_fecha)/7.0)::int; END IF;
  SELECT coalesce(tipos,'[]'::jsonb) || coalesce(bebidas,'[]'::jsonb) INTO v_config FROM config ORDER BY updated_at DESC, id DESC LIMIT 1;
  FOR v_linea IN SELECT value FROM jsonb_array_elements(p_detalle) LOOP
    v_tipo := v_linea->>'tipo';
    IF auth.uid() IS NULL AND ((EXISTS (SELECT 1 FROM config c, jsonb_array_elements(coalesce(c.bebidas,'[]'::jsonb)) b WHERE b->>'tipo'=v_tipo) AND NOT coalesce(v_bebidas_abiertas,false)) OR (NOT EXISTS (SELECT 1 FROM config c, jsonb_array_elements(coalesce(c.bebidas,'[]'::jsonb)) b WHERE b->>'tipo'=v_tipo) AND NOT coalesce(v_tamales_abiertos,false))) THEN RAISE EXCEPTION 'Los pedidos de esta categoria estan cerrados'; END IF;
    IF NOT coalesce((v_linea->>'cantidad') ~ '^[1-9][0-9]*$', false) THEN RAISE EXCEPTION 'Cantidad invalida'; END IF;
    v_cantidad := (v_linea->>'cantidad')::int;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_config,'[]'::jsonb)) t WHERE t->>'tipo'=v_tipo AND coalesce((t->>'activo')::boolean,true)) THEN RAISE EXCEPTION 'Este producto ya no esta disponible'; END IF;
    SELECT (t->>'precio')::numeric INTO v_precio FROM jsonb_array_elements(v_config) t WHERE t->>'tipo'=v_tipo;
    SELECT greatest(coalesce(i.cantidad_inicial,0)
      - coalesce((SELECT sum((d->>'cantidad')::int) FROM pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.detalle) d WHERE p.fecha_operativa=v_fecha AND d->>'tipo'=v_tipo),0)
      - coalesce((SELECT sum((d->>'cantidad')::int) FROM pedido_apartados a CROSS JOIN LATERAL jsonb_array_elements(a.detalle) d WHERE a.fecha_operativa=v_fecha AND a.estado='Activo' AND a.vence_en>now() AND d->>'tipo'=v_tipo),0),0)
      INTO v_disponible FROM (SELECT 1) x LEFT JOIN inventario i ON i.fecha_operativa=v_fecha AND i.tipo=v_tipo AND NOT i.cerrado;
    IF v_cantidad > v_disponible THEN RAISE EXCEPTION 'Solo quedan % de %',v_disponible,v_tipo; END IF;
    v_normalizado := v_normalizado || jsonb_build_array(jsonb_build_object('tipo',v_tipo,'cantidad',v_cantidad,'precio',v_precio));
  END LOOP;
  INSERT INTO pedido_apartados (semana,fecha_operativa,detalle,vence_en) VALUES (v_semana,v_fecha,v_normalizado,now()+interval '10 minutes') RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'vence_en',now()+interval '10 minutes');
END; $$;

CREATE OR REPLACE FUNCTION confirmar_apartado_publico(p_id uuid, p_cliente text, p_telefono text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_apartado pedido_apartados%ROWTYPE; v_pedido pedidos%ROWTYPE; v_total integer:=0; v_monto numeric:=0; v_linea jsonb; v_precio numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(94713281);
  SELECT * INTO v_apartado FROM pedido_apartados WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El apartado ya no existe'; END IF;
  IF v_apartado.estado='Confirmado' THEN
    SELECT * INTO v_pedido FROM pedidos WHERE id=v_apartado.pedido_id;
    RETURN jsonb_build_object('id',v_pedido.id,'folio',upper(substr(v_pedido.id::text,1,8)));
  END IF;
  IF v_apartado.estado<>'Activo' OR v_apartado.vence_en<=now() THEN UPDATE pedido_apartados SET estado='Expirado' WHERE id=p_id; RAISE EXCEPTION 'El apartado vencio. Revisa disponibilidad e intenta de nuevo'; END IF;
  IF length(trim(coalesce(p_cliente,'')))<2 OR (coalesce(p_telefono,'')<>'' AND length(trim(p_telefono))<8) THEN RAISE EXCEPTION 'Escribe tu nombre y un telefono valido'; END IF;
  FOR v_linea IN SELECT value FROM jsonb_array_elements(v_apartado.detalle) LOOP
    v_precio := (v_linea->>'precio')::numeric; v_total:=v_total+(v_linea->>'cantidad')::int; v_monto:=v_monto+(v_linea->>'cantidad')::int*coalesce(v_precio,0);
  END LOOP;
  INSERT INTO pedidos (semana,fecha_operativa,cliente,telefono,detalle,cantidad_total,monto_esperado,estado,origen)
    VALUES(v_apartado.semana,v_apartado.fecha_operativa,trim(p_cliente),nullif(trim(coalesce(p_telefono,'')),''),v_apartado.detalle,v_total,v_monto,'Pendiente','cliente') RETURNING * INTO v_pedido;
  UPDATE pedido_apartados SET estado='Confirmado',pedido_id=v_pedido.id,pedido_folio=upper(substr(v_pedido.id::text,1,8)),telefono_cliente=nullif(trim(coalesce(p_telefono,'')),'') WHERE id=p_id;
  RETURN jsonb_build_object('id',v_pedido.id,'folio',upper(substr(v_pedido.id::text,1,8)));
END; $$;

CREATE OR REPLACE FUNCTION cancelar_pedido_panel(p_id uuid,p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pedido pedidos%ROWTYPE; v_motivo text:=trim(coalesce(p_motivo,''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  IF length(v_motivo)<3 THEN RAISE EXCEPTION 'Escribe el motivo de cancelacion'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  SELECT * INTO v_pedido FROM pedidos WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido ya no existe'; END IF;
  INSERT INTO cancelaciones_pedido(folio,telefono,motivo,detalle,cantidad_total,monto_esperado)
    VALUES(upper(substr(v_pedido.id::text,1,8)),coalesce(v_pedido.telefono,''),v_motivo,v_pedido.detalle,v_pedido.cantidad_total,v_pedido.monto_esperado);
  UPDATE pedido_apartados SET estado='Cancelado',pedido_folio=upper(substr(v_pedido.id::text,1,8)),telefono_cliente=coalesce(v_pedido.telefono,''),motivo_cancelacion=v_motivo,pedido_id=NULL WHERE pedido_id=p_id;
  DELETE FROM pedidos WHERE id=p_id;
END; $$;

CREATE OR REPLACE FUNCTION consultar_estado_pedido(p_folio text,p_telefono text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pedido pedidos%ROWTYPE; v_cancelacion cancelaciones_pedido%ROWTYPE; v_folio text:=upper(trim(coalesce(p_folio,''))); v_telefono text:=regexp_replace(coalesce(p_telefono,''),'[^0-9]','','g');
BEGIN
  IF length(v_folio)<>8 OR length(v_telefono)<8 THEN RAISE EXCEPTION 'Escribe el folio de 8 caracteres y el telefono usado en el pedido'; END IF;
  SELECT p.* INTO v_pedido FROM pedidos p WHERE upper(substr(p.id::text,1,8))=v_folio AND regexp_replace(coalesce(p.telefono,''),'[^0-9]','','g')=v_telefono ORDER BY p.created_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('folio',v_folio,'estado',v_pedido.estado,'cliente',v_pedido.cliente,'detalle',v_pedido.detalle,'cantidad_total',v_pedido.cantidad_total,'monto_esperado',v_pedido.monto_esperado,'puede_cancelar',v_pedido.estado='Pendiente'); END IF;
  SELECT c.* INTO v_cancelacion FROM cancelaciones_pedido c WHERE upper(c.folio)=v_folio AND regexp_replace(c.telefono,'[^0-9]','','g')=v_telefono ORDER BY c.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No encontramos un pedido con esos datos'; END IF;
  RETURN jsonb_build_object('folio',v_folio,'estado','Cancelado','detalle',v_cancelacion.detalle,'cantidad_total',v_cancelacion.cantidad_total,'monto_esperado',v_cancelacion.monto_esperado,'motivo',v_cancelacion.motivo,'puede_cancelar',false);
END; $$;

CREATE OR REPLACE FUNCTION cancelar_pedido_cliente(p_folio text,p_telefono text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pedido pedidos%ROWTYPE; v_folio text:=upper(trim(coalesce(p_folio,''))); v_telefono text:=regexp_replace(coalesce(p_telefono,''),'[^0-9]','','g');
BEGIN
  IF length(v_folio)<>8 OR length(v_telefono)<8 THEN RAISE EXCEPTION 'Escribe el folio y el telefono usado en el pedido'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  SELECT p.* INTO v_pedido FROM pedidos p WHERE upper(substr(p.id::text,1,8))=v_folio AND regexp_replace(coalesce(p.telefono,''),'[^0-9]','','g')=v_telefono AND p.estado='Pendiente' ORDER BY p.created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este pedido ya no esta pendiente o no se encontro'; END IF;
  INSERT INTO cancelaciones_pedido(folio,telefono,motivo,detalle,cantidad_total,monto_esperado)
    VALUES(v_folio,coalesce(v_pedido.telefono,''),'Cancelado por el cliente',v_pedido.detalle,v_pedido.cantidad_total,v_pedido.monto_esperado);
  UPDATE pedido_apartados SET estado='Cancelado',pedido_folio=v_folio,telefono_cliente=coalesce(v_pedido.telefono,''),motivo_cancelacion='Cancelado por el cliente',pedido_id=NULL WHERE pedido_id=v_pedido.id;
  DELETE FROM pedidos WHERE id=v_pedido.id;
  RETURN jsonb_build_object('folio',v_folio,'estado','Cancelado');
END; $$;

CREATE OR REPLACE FUNCTION editar_pedido_panel(p_id uuid, p_cliente text, p_detalle jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pedido pedidos%ROWTYPE; v_det jsonb; v_tipo text; v_nuevo integer; v_stock integer; v_consumido integer; v_apartado integer; v_config jsonb; v_precio numeric; v_total integer:=0; v_monto numeric:=0; v_normalizado jsonb:='[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  SELECT * INTO v_pedido FROM pedidos WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_pedido.estado<>'Pendiente' THEN RAISE EXCEPTION 'Solo se pueden editar pedidos pendientes'; END IF;
  IF coalesce(jsonb_typeof(p_detalle),'')<>'array' OR jsonb_array_length(p_detalle)=0 THEN RAISE EXCEPTION 'El pedido no tiene productos'; END IF;
  SELECT tipos INTO v_config FROM config ORDER BY updated_at DESC, id DESC LIMIT 1;
  FOR v_det IN SELECT value FROM jsonb_array_elements(p_detalle) LOOP
    v_tipo:=v_det->>'tipo'; IF NOT coalesce((v_det->>'cantidad')~'^[1-9][0-9]*$',false) THEN RAISE EXCEPTION 'Cantidad invalida'; END IF; v_nuevo:=(v_det->>'cantidad')::int;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_config) t WHERE t->>'tipo'=v_tipo) THEN RAISE EXCEPTION 'Tipo de tamal no valido'; END IF;
    SELECT coalesce(cantidad_inicial,0) INTO v_stock FROM inventario WHERE fecha_operativa=v_pedido.fecha_operativa AND tipo=v_tipo; v_stock:=coalesce(v_stock,0);
    SELECT coalesce(sum((d->>'cantidad')::int),0) INTO v_consumido FROM pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.detalle) d WHERE p.fecha_operativa=v_pedido.fecha_operativa AND p.id<>p_id AND d->>'tipo'=v_tipo;
    SELECT coalesce(sum((d->>'cantidad')::int),0) INTO v_apartado FROM pedido_apartados a CROSS JOIN LATERAL jsonb_array_elements(a.detalle) d WHERE a.fecha_operativa=v_pedido.fecha_operativa AND a.estado='Activo' AND a.vence_en>now() AND d->>'tipo'=v_tipo;
    IF v_nuevo>greatest(v_stock-v_consumido-v_apartado,0) THEN RAISE EXCEPTION 'No hay suficiente inventario de %',v_tipo; END IF;
    SELECT (t->>'precio')::numeric INTO v_precio FROM jsonb_array_elements(v_config) t WHERE t->>'tipo'=v_tipo;
    v_total:=v_total+v_nuevo;v_monto:=v_monto+v_nuevo*v_precio;v_normalizado:=v_normalizado||jsonb_build_array(jsonb_build_object('tipo',v_tipo,'cantidad',v_nuevo,'precio',v_precio));
  END LOOP;
  UPDATE pedidos SET cliente=trim(p_cliente),detalle=v_normalizado,cantidad_total=v_total,monto_esperado=v_monto WHERE id=p_id;
END; $$;

CREATE OR REPLACE FUNCTION guardar_inventario_diario(p_fecha date,p_semana text,p_items jsonb,p_abrir_tamales boolean,p_abrir_bebidas boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item jsonb;v_tipo text;v_cantidad integer;v_usado integer;v_hoy date:=(now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  IF p_fecha<>v_hoy THEN RAISE EXCEPTION 'Solo puedes preparar el inventario para la fecha de hoy'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_tipo:=v_item->>'tipo';v_cantidad:=(v_item->>'cantidad')::int;
    SELECT coalesce(sum((d->>'cantidad')::int),0) INTO v_usado FROM pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.detalle) d WHERE p.fecha_operativa=p_fecha AND d->>'tipo'=v_tipo;
    v_usado:=v_usado+(SELECT coalesce(sum((d->>'cantidad')::int),0) FROM pedido_apartados a CROSS JOIN LATERAL jsonb_array_elements(a.detalle) d WHERE a.fecha_operativa=p_fecha AND a.estado='Activo' AND a.vence_en>now() AND d->>'tipo'=v_tipo);
    IF v_cantidad<v_usado THEN RAISE EXCEPTION 'No puedes fijar el inventario por debajo de lo pedido o apartado de %',v_tipo; END IF;
  END LOOP;
  INSERT INTO inventario(semana,tipo,cantidad_inicial,fecha_operativa)
    SELECT p_semana,item->>'tipo',(item->>'cantidad')::int,p_fecha FROM jsonb_array_elements(p_items) item
    ON CONFLICT (fecha_operativa,tipo) WHERE fecha_operativa IS NOT NULL DO UPDATE SET semana=EXCLUDED.semana,cantidad_inicial=EXCLUDED.cantidad_inicial,cerrado=false;
  INSERT INTO semana_activa(id,semana,fecha_operativa,pedidos_abiertos,tamales_abiertos,bebidas_abiertas) VALUES(1,p_semana,p_fecha,coalesce(p_abrir_tamales,false) OR coalesce(p_abrir_bebidas,false),coalesce(p_abrir_tamales,false),coalesce(p_abrir_bebidas,false))
    ON CONFLICT(id) DO UPDATE SET semana=EXCLUDED.semana,fecha_operativa=EXCLUDED.fecha_operativa,pedidos_abiertos=EXCLUDED.pedidos_abiertos,tamales_abiertos=EXCLUDED.tamales_abiertos,bebidas_abiertas=EXCLUDED.bebidas_abiertas;
END; $$;

CREATE OR REPLACE FUNCTION guardar_inventario_diario(p_fecha date,p_semana text,p_items jsonb,p_abrir boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM guardar_inventario_diario(p_fecha,p_semana,p_items,p_abrir,p_abrir);
END; $$;

CREATE OR REPLACE FUNCTION cambiar_estado_pedidos_diarios(p_abierto boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fecha date;v_hoy date:=(now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  SELECT fecha_operativa INTO v_fecha FROM semana_activa WHERE id=1 FOR UPDATE;
  IF v_fecha IS NULL OR v_fecha<>v_hoy THEN RAISE EXCEPTION 'Guarda primero el inventario de hoy'; END IF;
  IF p_abierto AND NOT EXISTS(SELECT 1 FROM inventario WHERE fecha_operativa=v_hoy AND NOT cerrado) THEN RAISE EXCEPTION 'Guarda primero el inventario de hoy'; END IF;
  UPDATE semana_activa SET pedidos_abiertos=coalesce(p_abierto,false),tamales_abiertos=coalesce(p_abierto,false),bebidas_abiertas=coalesce(p_abierto,false) WHERE id=1;
END; $$;

CREATE OR REPLACE FUNCTION cambiar_estado_pedidos_diarios_categoria(p_categoria text,p_abierto boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fecha date; v_tamales boolean; v_bebidas boolean; v_hoy date:=(now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  IF p_categoria NOT IN ('tamal','bebida') THEN RAISE EXCEPTION 'Categoria invalida'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  SELECT fecha_operativa,tamales_abiertos,bebidas_abiertas INTO v_fecha,v_tamales,v_bebidas FROM semana_activa WHERE id=1 FOR UPDATE;
  IF v_fecha IS NULL OR v_fecha<>v_hoy THEN
    v_tamales:=false;
    v_bebidas:=false;
  END IF;
  IF p_categoria='tamal' THEN v_tamales:=coalesce(p_abierto,false); ELSE v_bebidas:=coalesce(p_abierto,false); END IF;
  UPDATE semana_activa SET fecha_operativa=v_hoy,tamales_abiertos=v_tamales,bebidas_abiertas=v_bebidas,pedidos_abiertos=(v_tamales OR v_bebidas) WHERE id=1;
END; $$;

CREATE OR REPLACE FUNCTION cerrar_inventarios_anteriores()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cerrados integer; v_hoy date:=(now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  UPDATE inventario SET cerrado=true
  WHERE fecha_operativa IS NOT NULL AND fecha_operativa<v_hoy AND NOT cerrado;
  GET DIAGNOSTICS v_cerrados = ROW_COUNT;
  UPDATE semana_activa SET tamales_abiertos=false,bebidas_abiertas=false,pedidos_abiertos=false
  WHERE id=1 AND fecha_operativa<v_hoy;
  RETURN v_cerrados;
END; $$;

CREATE OR REPLACE FUNCTION cerrar_semana_panel(p_semana text,p_siguiente text,p_inversion numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hoy date:=(now() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  UPDATE pedido_apartados SET estado='Expirado' WHERE semana=p_semana AND estado='Activo';
  IF p_inversion IS NOT NULL THEN
    INSERT INTO cierres(semana,inversion,updated_at) VALUES(p_semana,p_inversion,now())
      ON CONFLICT(semana) DO UPDATE SET inversion=EXCLUDED.inversion,updated_at=now();
  END IF;
  DELETE FROM inventario WHERE fecha_operativa=v_hoy;
  INSERT INTO semana_activa(id,semana,fecha_operativa,pedidos_abiertos,tamales_abiertos,bebidas_abiertas) VALUES(1,p_siguiente,v_hoy,false,false,false)
    ON CONFLICT(id) DO UPDATE SET semana=EXCLUDED.semana,fecha_operativa=EXCLUDED.fecha_operativa,pedidos_abiertos=false,tamales_abiertos=false,bebidas_abiertas=false;
END; $$;

REVOKE ALL ON FUNCTION menu_publico() FROM PUBLIC;
REVOKE ALL ON FUNCTION crear_apartado_publico(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirmar_apartado_publico(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancelar_pedido_panel(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION consultar_estado_pedido(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancelar_pedido_cliente(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION guardar_inventario_diario(date,text,jsonb,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION guardar_inventario_diario(date,text,jsonb,boolean,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION cambiar_estado_pedidos_diarios(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION cambiar_estado_pedidos_diarios_categoria(text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION cerrar_inventarios_anteriores() FROM PUBLIC;
REVOKE ALL ON FUNCTION cerrar_semana_panel(text,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION editar_pedido_panel(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_publico() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION crear_apartado_publico(jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION confirmar_apartado_publico(uuid,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION cancelar_pedido_panel(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION consultar_estado_pedido(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION cancelar_pedido_cliente(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION guardar_inventario_diario(date,text,jsonb,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION guardar_inventario_diario(date,text,jsonb,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION cambiar_estado_pedidos_diarios(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION cambiar_estado_pedidos_diarios_categoria(text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION cerrar_inventarios_anteriores() TO authenticated;
GRANT EXECUTE ON FUNCTION cerrar_semana_panel(text,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION editar_pedido_panel(uuid,text,jsonb) TO authenticated;
