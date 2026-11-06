-- Apartados de 10 minutos y pedidos publicos. Ejecutar despues de tamales.sql.
-- Todas las operaciones de stock usan el mismo advisory lock de PostgreSQL.

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS telefono text;
ALTER TABLE config ADD COLUMN IF NOT EXISTS bebidas jsonb NOT NULL DEFAULT '[
  {"tipo": "Atole chico (500 ml)", "precio": 0, "activo": false},
  {"tipo": "Atole grande (1 L)", "precio": 0, "activo": false}
]'::jsonb;

CREATE TABLE IF NOT EXISTS pedido_apartados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  vence_en timestamptz NOT NULL,
  semana text NOT NULL,
  detalle jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'Activo' CHECK (estado IN ('Activo', 'Confirmado', 'Cancelado', 'Expirado')),
  pedido_id uuid REFERENCES pedidos(id)
);

CREATE INDEX IF NOT EXISTS idx_apartados_activos
  ON pedido_apartados (semana, vence_en) WHERE estado = 'Activo';

ALTER TABLE pedido_apartados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Panel ve apartados activos" ON pedido_apartados;
CREATE POLICY "Panel ve apartados activos" ON pedido_apartados FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION menu_publico()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_semana text;
  v_tipos jsonb;
  v_bebidas jsonb;
  v_tipos_resultado jsonb := '[]'::jsonb;
  v_bebidas_resultado jsonb := '[]'::jsonb;
  v_item jsonb;
  v_tipo text;
  v_inicial integer;
  v_pedidos integer;
  v_apartados integer;
BEGIN
  SELECT semana INTO v_semana FROM semana_activa WHERE id = 1;
  IF v_semana IS NULL THEN
    v_semana := to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYY-MM') || '-S' || ceil(extract(day FROM (now() AT TIME ZONE 'America/Mexico_City')) / 7.0)::int;
  END IF;
  SELECT tipos, bebidas INTO v_tipos, v_bebidas FROM config ORDER BY updated_at DESC, id DESC LIMIT 1;
  FOR v_item IN
    SELECT value || jsonb_build_object('categoria', 'tamal') FROM jsonb_array_elements(coalesce(v_tipos, '[]'::jsonb))
    UNION ALL
    SELECT value || jsonb_build_object('categoria', 'bebida') FROM jsonb_array_elements(coalesce(v_bebidas, '[]'::jsonb))
      WHERE coalesce((value->>'activo')::boolean, false)
  LOOP
    v_tipo := v_item->>'tipo';
    SELECT coalesce(cantidad_inicial, 0) INTO v_inicial FROM inventario WHERE semana = v_semana AND tipo = v_tipo;
    v_inicial := coalesce(v_inicial, 0);
    SELECT coalesce(sum((d->>'cantidad')::int), 0) INTO v_pedidos
      FROM pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.detalle) d
      WHERE p.semana = v_semana AND d->>'tipo' = v_tipo;
    SELECT coalesce(sum((d->>'cantidad')::int), 0) INTO v_apartados
      FROM pedido_apartados a CROSS JOIN LATERAL jsonb_array_elements(a.detalle) d
      WHERE a.semana = v_semana AND a.estado = 'Activo' AND a.vence_en > now() AND d->>'tipo' = v_tipo;
    IF v_item->>'categoria' = 'bebida' THEN
      v_bebidas_resultado := v_bebidas_resultado || jsonb_build_array(jsonb_build_object(
        'tipo', v_tipo, 'precio', (v_item->>'precio')::numeric,
        'disponible', greatest(v_inicial - v_pedidos - v_apartados, 0)
      ));
    ELSE
      v_tipos_resultado := v_tipos_resultado || jsonb_build_array(jsonb_build_object(
      'tipo', v_tipo, 'precio', (v_item->>'precio')::numeric,
      'disponible', greatest(v_inicial - v_pedidos - v_apartados, 0)
      ));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('semana', v_semana, 'fecha', to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD'), 'tipos', v_tipos_resultado, 'bebidas', v_bebidas_resultado);
END; $$;

CREATE OR REPLACE FUNCTION crear_apartado_publico(p_detalle jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_semana text;
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
  IF coalesce(jsonb_typeof(p_detalle), '') <> 'array' THEN RAISE EXCEPTION 'El pedido no tiene un formato valido'; END IF;
  IF jsonb_array_length(p_detalle) = 0 THEN RAISE EXCEPTION 'Agrega al menos un tamal al pedido'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_detalle)) <> (SELECT count(DISTINCT value->>'tipo') FROM jsonb_array_elements(p_detalle)) THEN
    RAISE EXCEPTION 'Combina las cantidades del mismo tipo de tamal';
  END IF;
  SELECT semana INTO v_semana FROM semana_activa WHERE id = 1;
  IF v_semana IS NULL THEN
    v_semana := to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYY-MM') || '-S' || ceil(extract(day FROM (now() AT TIME ZONE 'America/Mexico_City')) / 7.0)::int;
  END IF;
  SELECT coalesce(tipos, '[]'::jsonb) || coalesce(bebidas, '[]'::jsonb) INTO v_config FROM config ORDER BY updated_at DESC, id DESC LIMIT 1;
  FOR v_linea IN SELECT value FROM jsonb_array_elements(p_detalle) LOOP
    v_tipo := v_linea->>'tipo';
    IF NOT coalesce((v_linea->>'cantidad') ~ '^[1-9][0-9]*$', false) THEN RAISE EXCEPTION 'Cantidad invalida'; END IF;
    v_cantidad := (v_linea->>'cantidad')::int;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_config, '[]'::jsonb)) t WHERE t->>'tipo' = v_tipo AND coalesce((t->>'activo')::boolean, true)) THEN
      RAISE EXCEPTION 'Este tipo de tamal ya no esta en el menu';
    END IF;
    SELECT (t->>'precio')::numeric INTO v_precio FROM jsonb_array_elements(v_config) t WHERE t->>'tipo'=v_tipo;
    SELECT greatest(coalesce(i.cantidad_inicial, 0)
      - coalesce((SELECT sum((d->>'cantidad')::int) FROM pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.detalle) d WHERE p.semana=v_semana AND d->>'tipo'=v_tipo), 0)
      - coalesce((SELECT sum((d->>'cantidad')::int) FROM pedido_apartados a CROSS JOIN LATERAL jsonb_array_elements(a.detalle) d WHERE a.semana=v_semana AND a.estado='Activo' AND a.vence_en>now() AND d->>'tipo'=v_tipo), 0), 0)
      INTO v_disponible FROM (SELECT 1) x LEFT JOIN inventario i ON i.semana=v_semana AND i.tipo=v_tipo;
    IF v_cantidad > v_disponible THEN RAISE EXCEPTION 'Solo quedan % de %', v_disponible, v_tipo; END IF;
    v_normalizado := v_normalizado || jsonb_build_array(jsonb_build_object('tipo', v_tipo, 'cantidad', v_cantidad, 'precio', v_precio));
  END LOOP;
  INSERT INTO pedido_apartados (semana, detalle, vence_en)
    VALUES (v_semana, v_normalizado, now() + interval '10 minutes') RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'vence_en', now() + interval '10 minutes');
END; $$;

CREATE OR REPLACE FUNCTION confirmar_apartado_publico(p_id uuid, p_cliente text, p_telefono text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_apartado pedido_apartados%ROWTYPE;
  v_pedido pedidos%ROWTYPE;
  v_config jsonb;
  v_total integer := 0;
  v_monto numeric := 0;
  v_linea jsonb;
  v_precio numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(94713281);
  SELECT * INTO v_apartado FROM pedido_apartados WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El apartado ya no existe'; END IF;
  IF v_apartado.estado = 'Confirmado' THEN
    SELECT * INTO v_pedido FROM pedidos WHERE id=v_apartado.pedido_id;
    RETURN jsonb_build_object('id', v_pedido.id, 'folio', upper(substr(v_pedido.id::text, 1, 8)));
  END IF;
  IF v_apartado.estado <> 'Activo' OR v_apartado.vence_en <= now() THEN
    UPDATE pedido_apartados SET estado='Expirado' WHERE id=p_id;
    RAISE EXCEPTION 'Se vencio el tiempo del apartado. Revisa la disponibilidad y comienza de nuevo.';
  END IF;
  IF length(trim(coalesce(p_cliente,''))) < 2 OR (coalesce(p_telefono,'') <> '' AND length(trim(p_telefono)) < 8) THEN
    RAISE EXCEPTION 'Escribe tu nombre y un telefono valido';
  END IF;
  SELECT tipos INTO v_config FROM config ORDER BY updated_at DESC, id DESC LIMIT 1;
  FOR v_linea IN SELECT value FROM jsonb_array_elements(v_apartado.detalle) LOOP
    v_precio := (v_linea->>'precio')::numeric;
    v_total := v_total + (v_linea->>'cantidad')::int;
    v_monto := v_monto + (v_linea->>'cantidad')::int * coalesce(v_precio, 0);
  END LOOP;
  INSERT INTO pedidos (semana, cliente, telefono, detalle, cantidad_total, monto_esperado, estado)
    VALUES (v_apartado.semana, trim(p_cliente), nullif(trim(coalesce(p_telefono,'')), ''), v_apartado.detalle, v_total, v_monto, 'Pendiente')
    RETURNING * INTO v_pedido;
  UPDATE pedido_apartados SET estado='Confirmado', pedido_id=v_pedido.id WHERE id=p_id;
  RETURN jsonb_build_object('id', v_pedido.id, 'folio', upper(substr(v_pedido.id::text, 1, 8)));
END; $$;

CREATE OR REPLACE FUNCTION cancelar_apartado_publico(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE pedido_apartados SET estado='Cancelado' WHERE id=p_id AND estado='Activo';
END; $$;

CREATE OR REPLACE FUNCTION crear_pedido_panel(p_cliente text, p_detalle jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hold jsonb; v_pedido jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  v_hold := crear_apartado_publico(p_detalle);
  v_pedido := confirmar_apartado_publico((v_hold->>'id')::uuid, p_cliente, null);
  RETURN v_pedido;
END; $$;

CREATE OR REPLACE FUNCTION editar_pedido_panel(p_id uuid, p_cliente text, p_detalle jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pedido pedidos%ROWTYPE; v_holds jsonb; v_hold jsonb;
  v_det jsonb; v_tipo text; v_nuevo integer; v_stock integer; v_consumido integer; v_apartado integer;
  v_config jsonb; v_precio numeric; v_total integer := 0; v_monto numeric := 0; v_normalizado jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  SELECT * INTO v_pedido FROM pedidos WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_pedido.estado <> 'Pendiente' THEN RAISE EXCEPTION 'Solo se pueden editar pedidos pendientes'; END IF;
  IF coalesce(jsonb_typeof(p_detalle), '') <> 'array' THEN RAISE EXCEPTION 'El pedido no tiene un formato valido'; END IF;
  IF jsonb_array_length(p_detalle) = 0 THEN RAISE EXCEPTION 'El pedido no tiene tamales'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_detalle)) <> (SELECT count(DISTINCT value->>'tipo') FROM jsonb_array_elements(p_detalle)) THEN
    RAISE EXCEPTION 'Combina las cantidades del mismo tipo de tamal';
  END IF;
  SELECT tipos INTO v_config FROM config ORDER BY updated_at DESC, id DESC LIMIT 1;
  FOR v_det IN SELECT value FROM jsonb_array_elements(p_detalle) LOOP
    v_tipo := v_det->>'tipo';
    IF NOT coalesce((v_det->>'cantidad') ~ '^[1-9][0-9]*$', false) THEN RAISE EXCEPTION 'Cantidad invalida'; END IF;
    v_nuevo := (v_det->>'cantidad')::int;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_config) t WHERE t->>'tipo'=v_tipo) THEN RAISE EXCEPTION 'Tipo de tamal no valido'; END IF;
    SELECT coalesce(cantidad_inicial,0) INTO v_stock FROM inventario WHERE semana=v_pedido.semana AND tipo=v_tipo;
    v_stock := coalesce(v_stock,0);
    SELECT coalesce(sum((d->>'cantidad')::int),0) INTO v_consumido FROM pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.detalle) d WHERE p.semana=v_pedido.semana AND p.id<>p_id AND d->>'tipo'=v_tipo;
    SELECT coalesce(sum((d->>'cantidad')::int),0) INTO v_apartado FROM pedido_apartados a CROSS JOIN LATERAL jsonb_array_elements(a.detalle) d WHERE a.semana=v_pedido.semana AND a.estado='Activo' AND a.vence_en>now() AND d->>'tipo'=v_tipo;
    IF v_nuevo > greatest(v_stock-v_consumido-v_apartado,0) THEN RAISE EXCEPTION 'No hay suficiente inventario de %', v_tipo; END IF;
    SELECT (t->>'precio')::numeric INTO v_precio FROM jsonb_array_elements(v_config) t WHERE t->>'tipo'=v_tipo;
    v_total := v_total + v_nuevo; v_monto := v_monto + v_nuevo*v_precio;
    v_normalizado := v_normalizado || jsonb_build_array(jsonb_build_object('tipo',v_tipo,'cantidad',v_nuevo,'precio',v_precio));
  END LOOP;
  UPDATE pedidos SET cliente=trim(p_cliente), detalle=v_normalizado, cantidad_total=v_total, monto_esperado=v_monto WHERE id=p_id;
END; $$;

CREATE OR REPLACE FUNCTION guardar_inventario_panel(p_semana text, p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item jsonb; v_tipo text; v_cantidad integer; v_usado integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_tipo := v_item->>'tipo'; v_cantidad := (v_item->>'cantidad')::int;
    SELECT coalesce(sum((d->>'cantidad')::int),0) INTO v_usado FROM pedidos p CROSS JOIN LATERAL jsonb_array_elements(p.detalle) d WHERE p.semana=p_semana AND d->>'tipo'=v_tipo;
    v_usado := v_usado + (SELECT coalesce(sum((d->>'cantidad')::int),0) FROM pedido_apartados a CROSS JOIN LATERAL jsonb_array_elements(a.detalle) d WHERE a.semana=p_semana AND a.estado='Activo' AND a.vence_en>now() AND d->>'tipo'=v_tipo);
    IF v_cantidad < v_usado THEN RAISE EXCEPTION 'No puedes fijar el inventario por debajo de las cantidades pedidas o apartadas de %', v_tipo; END IF;
  END LOOP;
  INSERT INTO inventario (semana,tipo,cantidad_inicial) SELECT p_semana, item->>'tipo', (item->>'cantidad')::int FROM jsonb_array_elements(p_items) item
    ON CONFLICT (semana,tipo) DO UPDATE SET cantidad_inicial=EXCLUDED.cantidad_inicial;
END; $$;

CREATE OR REPLACE FUNCTION cerrar_semana_panel(p_semana text, p_siguiente text, p_inversion numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Se requiere iniciar sesion'; END IF;
  PERFORM pg_advisory_xact_lock(94713281);
  UPDATE pedido_apartados SET estado='Expirado' WHERE semana=p_semana AND estado='Activo';
  IF p_inversion IS NOT NULL THEN
    INSERT INTO cierres (semana,inversion,updated_at) VALUES (p_semana,p_inversion,now())
      ON CONFLICT (semana) DO UPDATE SET inversion=EXCLUDED.inversion, updated_at=now();
  END IF;
  INSERT INTO inventario (semana,tipo,cantidad_inicial)
    SELECT p_siguiente, item->>'tipo', 0 FROM (SELECT coalesce(tipos,'[]'::jsonb) || coalesce(bebidas,'[]'::jsonb) AS productos FROM config ORDER BY updated_at DESC, id DESC LIMIT 1) c CROSS JOIN LATERAL jsonb_array_elements(c.productos) item
    ON CONFLICT (semana,tipo) DO UPDATE SET cantidad_inicial=0;
  INSERT INTO semana_activa (id,semana) VALUES (1,p_siguiente)
    ON CONFLICT (id) DO UPDATE SET semana=EXCLUDED.semana;
END; $$;

REVOKE ALL ON FUNCTION menu_publico() FROM PUBLIC;
REVOKE ALL ON FUNCTION crear_apartado_publico(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirmar_apartado_publico(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancelar_apartado_publico(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crear_pedido_panel(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_publico() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION crear_apartado_publico(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION confirmar_apartado_publico(uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cancelar_apartado_publico(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION crear_pedido_panel(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION editar_pedido_panel(uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION guardar_inventario_panel(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION cerrar_semana_panel(text,text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION editar_pedido_panel(uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION guardar_inventario_panel(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION cerrar_semana_panel(text,text,numeric) TO authenticated;
