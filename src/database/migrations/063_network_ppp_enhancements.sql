-- ==============================================================================
-- MIGRACIÓN 063: Mejoras para Perfiles PPP y Secretos PPPoE (Nivel 2)
-- Requisitos: RF-PPP-001 a RF-PPP-010
-- ==============================================================================

-- 1. Campos adicionales para NetworkNodeEntity (colas padre y pools IP)
ALTER TABLE "net"."network_nodes"
  ADD COLUMN IF NOT EXISTS "default_parent_queue" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "default_ppp_pool" VARCHAR(100);

-- 2. Campos adicionales para NetworkAccessEntity (contraseña cifrada y MAC activa)
ALTER TABLE "net"."network_access"
  ADD COLUMN IF NOT EXISTS "pppoe_password_enc" TEXT,
  ADD COLUMN IF NOT EXISTS "mac_address" VARCHAR(17),
  ADD COLUMN IF NOT EXISTS "last_caller_id" VARCHAR(50);

CREATE INDEX IF NOT EXISTS "idx_network_access_username" ON "net"."network_access" ("username");
CREATE INDEX IF NOT EXISTS "idx_network_access_mac_address" ON "net"."network_access" ("mac_address");
