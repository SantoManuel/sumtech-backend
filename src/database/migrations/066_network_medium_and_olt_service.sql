-- ==============================================================================
-- MIGRACIÓN 066: Servicio del Cliente y Medio de Control (Nivel 5)
-- Requisitos: RF-RED-001, RF-RED-002, RF-PPPOE-002, RF-OLT-009
-- ==============================================================================

-- 1. Medio de suspensión en nodos de red MikroTik
ALTER TABLE "net"."network_nodes"
  ADD COLUMN IF NOT EXISTS "suspension_medium" VARCHAR(30) NOT NULL DEFAULT 'PPPOE';

-- Restricción de valores válidos para suspension_medium en network_nodes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_network_nodes_suspension_medium'
  ) THEN
    ALTER TABLE "net"."network_nodes"
      ADD CONSTRAINT "chk_network_nodes_suspension_medium"
      CHECK ("suspension_medium" IN ('PPPOE', 'OLT_NATIVE'));
  END IF;
END $$;

-- 2. Vinculación de ONU y override de medio en accesos de red
ALTER TABLE "net"."network_access"
  ADD COLUMN IF NOT EXISTS "onu_id" UUID REFERENCES "net"."onus"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "suspension_medium_override" VARCHAR(30);

-- Restricción de valores válidos para suspension_medium_override en network_access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_network_access_suspension_override'
  ) THEN
    ALTER TABLE "net"."network_access"
      ADD CONSTRAINT "chk_network_access_suspension_override"
      CHECK ("suspension_medium_override" IS NULL OR "suspension_medium_override" IN ('PPPOE', 'OLT_NATIVE'));
  END IF;
END $$;

-- 3. Perfiles técnicos en planes comerciales (RF-OLT-009 y RF-PPP-001)
ALTER TABLE "com"."plans"
  ADD COLUMN IF NOT EXISTS "ppp_profile_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "olt_speed_profile_id" UUID REFERENCES "net"."olt_speed_profiles"("id") ON DELETE SET NULL;

-- 4. Índices para rendimiento de consultas en cadena y resolución de medio
CREATE INDEX IF NOT EXISTS "idx_network_access_onu_id" ON "net"."network_access" ("onu_id");
CREATE INDEX IF NOT EXISTS "idx_plans_olt_speed_profile_id" ON "com"."plans" ("olt_speed_profile_id");
