-- Cierres financieros por día de operación.
-- Solo se permite cerrar una fecha que tenga inventario registrado.
CREATE TABLE IF NOT EXISTS cierres_diarios (
  fecha_operativa date PRIMARY KEY,
  inversion numeric NOT NULL DEFAULT 0 CHECK (inversion >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cierres_diarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuarios autenticados - cierres diarios" ON cierres_diarios;
CREATE POLICY "Usuarios autenticados - cierres diarios"
  ON cierres_diarios FOR SELECT
  USING (auth.role() = 'authenticated');
REVOKE INSERT, UPDATE, DELETE ON cierres_diarios FROM anon, authenticated;
GRANT SELECT ON cierres_diarios TO authenticated;

CREATE OR REPLACE FUNCTION guardar_cierre_diario(p_fecha date, p_inversion numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Se requiere una sesión autenticada';
  END IF;
  IF p_fecha IS NULL OR p_inversion IS NULL OR p_inversion < 0 THEN
    RAISE EXCEPTION 'La fecha y una inversión válida son obligatorias';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM inventario
    WHERE fecha_operativa = p_fecha
  ) THEN
    RAISE EXCEPTION 'No se puede cerrar un día sin inventario registrado';
  END IF;

  INSERT INTO cierres_diarios (fecha_operativa, inversion, updated_at)
  VALUES (p_fecha, p_inversion, now())
  ON CONFLICT (fecha_operativa) DO UPDATE
    SET inversion = EXCLUDED.inversion,
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION guardar_cierre_diario(date, numeric) TO authenticated;
