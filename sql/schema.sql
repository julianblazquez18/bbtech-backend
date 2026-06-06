-- ============================================================
-- BBTECH — PostgreSQL Schema
-- Multi-tenant desde el día uno
-- Ejecutar en Neon: copiar y pegar en el SQL Editor
-- ============================================================

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── TENANTS ──────────────────────────────────────────────────
-- Cada empresa/familia es un tenant
CREATE TABLE tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       TEXT NOT NULL,
  creado_en    TIMESTAMPTZ DEFAULT NOW()
);

-- ── USUARIOS ─────────────────────────────────────────────────
CREATE TABLE usuarios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nombre       TEXT NOT NULL,
  rol          TEXT NOT NULL DEFAULT 'usuario',  -- 'admin' | 'usuario'
  creado_en    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_usuarios_tenant ON usuarios(tenant_id);
CREATE INDEX idx_usuarios_email  ON usuarios(email);

-- ── ESTANCIAS (campos) ───────────────────────────────────────
CREATE TABLE estancias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  icon         TEXT NOT NULL DEFAULT '🌾',
  orden        INTEGER DEFAULT 0,
  creado_en    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_estancias_tenant ON estancias(tenant_id);

-- ── GRUPOS (rodeos / vaquillonas) ────────────────────────────
CREATE TABLE grupos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  estancia_id  UUID NOT NULL REFERENCES estancias(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  tipo         TEXT NOT NULL DEFAULT 'rodeo',  -- 'rodeo' | 'vaquillona'
  orden        INTEGER DEFAULT 0,
  creado_en    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_grupos_tenant   ON grupos(tenant_id);
CREATE INDEX idx_grupos_estancia ON grupos(estancia_id);

-- ── LOTES ────────────────────────────────────────────────────
CREATE TABLE lotes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  orden        INTEGER DEFAULT 0,
  creado_en    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lotes_tenant ON lotes(tenant_id);

-- ── CICLOS (safras) ──────────────────────────────────────────
CREATE TABLE ciclos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grupo_id      UUID NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  fecha_inicio  DATE NOT NULL,
  fecha_cierre  DATE,
  lote          TEXT,
  obs           TEXT DEFAULT '',
  estado        TEXT NOT NULL DEFAULT 'activo',  -- 'activo' | 'cerrado'
  creado_en     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ciclos_tenant ON ciclos(tenant_id);
CREATE INDEX idx_ciclos_grupo  ON ciclos(grupo_id);

-- ── VACAS EN CICLO ───────────────────────────────────────────
-- Una vaca puede estar en múltiples ciclos (solapamiento)
-- La caravana NO es unique global — se usa traspasar/mover para duplicar
CREATE TABLE vacas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ciclo_id            UUID NOT NULL REFERENCES ciclos(id) ON DELETE CASCADE,
  caravana            TEXT NOT NULL,          -- número de caravana (ej: "1042")
  grupo_origen_id     UUID REFERENCES grupos(id),
  grupo_actual_id     UUID REFERENCES grupos(id),

  -- Etapa: ENTORE
  entore_estado       TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente|preniada|vacia
  entore_fecha        DATE,
  entore_obs          TEXT DEFAULT '',

  -- Etapa: PARTO
  parto_estado        TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente|pario|no_pario
  parto_fecha         DATE,
  parto_obs           TEXT DEFAULT '',
  parto_locked        BOOLEAN DEFAULT FALSE,  -- bloqueado por entore=vacia

  -- Etapa: DESTETE
  destete_estado      TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente|en_curso|desteto|no_desteto
  destete_fecha       DATE,
  destete_obs         TEXT DEFAULT '',
  destete_locked      BOOLEAN DEFAULT FALSE,  -- bloqueado por entore=vacia o parto=no_pario

  -- Descarte (independiente del ciclo)
  descarte            BOOLEAN DEFAULT FALSE,
  descarte_estado     TEXT DEFAULT 'pendiente',  -- pendiente|muerte|feedlot
  descarte_obs        TEXT DEFAULT '',
  descarte_fecha      DATE,

  -- Observación general
  obs                 TEXT DEFAULT '',

  creado_en           TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en      TIMESTAMPTZ DEFAULT NOW(),

  -- Una caravana no puede repetirse en el mismo ciclo (solo via mover/traspasar)
  UNIQUE(ciclo_id, caravana)
);
CREATE INDEX idx_vacas_tenant  ON vacas(tenant_id);
CREATE INDEX idx_vacas_ciclo   ON vacas(ciclo_id);
CREATE INDEX idx_vacas_caravana ON vacas(tenant_id, caravana);

-- ── MOVIMIENTOS de vacas (trazabilidad) ─────────────────────
CREATE TABLE movimientos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vaca_id       UUID NOT NULL REFERENCES vacas(id) ON DELETE CASCADE,
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  de_ciclo_id   UUID REFERENCES ciclos(id),
  a_ciclo_id    UUID REFERENCES ciclos(id),
  de_grupo_id   UUID REFERENCES grupos(id),
  a_grupo_id    UUID REFERENCES grupos(id),
  tipo          TEXT DEFAULT 'mover',  -- 'mover' | 'traspasar'
  creado_en     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_movimientos_vaca   ON movimientos(vaca_id);
CREATE INDEX idx_movimientos_tenant ON movimientos(tenant_id);

-- ── HISTORIAL de ciclos cerrados ─────────────────────────────
CREATE TABLE historial (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ciclo_id        UUID NOT NULL,  -- sin FK para preservar historial si se borra el ciclo
  ciclo_nombre    TEXT NOT NULL,
  grupo_id        UUID,
  grupo_nombre    TEXT,
  estancia_nombre TEXT,
  fecha_inicio    DATE,
  fecha_cierre    DATE,
  obs             TEXT,
  -- Stats snapshot al momento del cierre
  stats           JSONB NOT NULL DEFAULT '{}',
  -- Snapshot completo de las vacas al cierre
  vacas_snapshot  JSONB NOT NULL DEFAULT '[]',
  creado_en       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_historial_tenant ON historial(tenant_id);
CREATE INDEX idx_historial_ciclo  ON historial(ciclo_id);

-- ── TRIGGER: actualizado_en automático ───────────────────────
CREATE OR REPLACE FUNCTION update_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vacas_actualizado_en
  BEFORE UPDATE ON vacas
  FOR EACH ROW EXECUTE FUNCTION update_actualizado_en();

-- ============================================================
-- DATOS INICIALES — Tenant de tu familia
-- Ejecutar DESPUÉS del schema para tener el primer usuario
-- ============================================================

-- Insertar tenant de la familia
INSERT INTO tenants (id, nombre) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Familia BBTECH');

-- Insertar estancias
INSERT INTO estancias (id, tenant_id, nombre, icon, orden) VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'El Sorteo',    '🌾', 1),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'La Esmeralda', '🌿', 2);

-- Insertar grupos
INSERT INTO grupos (id, tenant_id, estancia_id, nombre, tipo, orden) VALUES
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'Rodeo 1',        'rodeo',      1),
  ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'Rodeo 2',        'rodeo',      2),
  ('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000002', 'Vaquillonas 15M','vaquillona', 1),
  ('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000002', 'Vaquillonas 24M','vaquillona', 2);

-- Insertar lotes por defecto
INSERT INTO lotes (tenant_id, nombre, orden) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Lote A',      1),
  ('00000000-0000-0000-0000-000000000001', 'Lote B',      2),
  ('00000000-0000-0000-0000-000000000001', 'Lote C',      3),
  ('00000000-0000-0000-0000-000000000001', 'Lote D',      4),
  ('00000000-0000-0000-0000-000000000001', 'Campo Norte',  5),
  ('00000000-0000-0000-0000-000000000001', 'Campo Sur',    6),
  ('00000000-0000-0000-0000-000000000001', 'Campo Este',   7);

-- Nota: el usuario admin se inserta via script separado (con bcrypt hash)
-- Ver: npm run seed
