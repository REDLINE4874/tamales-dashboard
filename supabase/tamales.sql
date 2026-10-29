-- ═══════════════════════════════════════════════════════════════════
--  TAMALES DASHBOARD — Setup de base de datos en Supabase
--  Ejecutar en: Supabase -> SQL Editor -> New query -> Run
-- ═══════════════════════════════════════════════════════════════════

-- 1. Tabla de configuración (tipos de tamal y precios individuales)
CREATE TABLE IF NOT EXISTS config (
  id      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipos   jsonb NOT NULL DEFAULT '[
    {"tipo": "Verde", "precio": 15},
    {"tipo": "Rojo", "precio": 15},
    {"tipo": "Dulce", "precio": 15},
    {"tipo": "Rajas con queso", "precio": 15}
  ]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- 2. Semana activa (id fijo = 1)
CREATE TABLE IF NOT EXISTS semana_activa (
  id      int PRIMARY KEY DEFAULT 1,
  semana  text NOT NULL
);

-- 3. Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at       timestamptz DEFAULT now() NOT NULL,
  semana           text NOT NULL,
  cliente          text NOT NULL,
  detalle          jsonb DEFAULT '[]'::jsonb NOT NULL,
  cantidad_total   int DEFAULT 0 NOT NULL,
  monto_esperado   numeric DEFAULT 0 NOT NULL,
  monto_cobrado    numeric,
  estado           text DEFAULT 'Pendiente' NOT NULL,
  fecha_completado timestamptz
);

-- 4. Inventario semanal por tipo
CREATE TABLE IF NOT EXISTS inventario (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  semana           text NOT NULL,
  tipo             text NOT NULL,
  cantidad_inicial int DEFAULT 0 NOT NULL,
  UNIQUE (semana, tipo)
);

-- 5. Cierres semanales (inversión y corte)
CREATE TABLE IF NOT EXISTS cierres (
  semana     text PRIMARY KEY,
  inversion  numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ─── Seguridad RLS (Row Level Security) ───────────────────────────
ALTER TABLE config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE semana_activa ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierres       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados - config"
  ON config FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuarios autenticados - semana_activa"
  ON semana_activa FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuarios autenticados - pedidos"
  ON pedidos FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuarios autenticados - inventario"
  ON inventario FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Usuarios autenticados - cierres"
  ON cierres FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ─── Índices ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pedidos_semana ON pedidos (semana);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos (estado);
CREATE INDEX IF NOT EXISTS idx_inventario_semana ON inventario (semana);
