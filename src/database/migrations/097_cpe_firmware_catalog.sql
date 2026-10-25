-- ==============================================================================
-- MIGRACIÓN 097: catálogo de firmware TR-069 (§3.17/§2.4 del plan)
-- Sección de mayor riesgo de toda la pestaña TR-069/GenieACS -- un firmware
-- incorrecto puede dejar el equipo inoperable. Esta tabla es el catálogo de
-- archivos de firmware que el equipo de soporte sube deliberadamente (nunca
-- se autodescubre nada), con su checksum para auditar qué se empujó.
-- Rollback manual:
--   DROP TABLE IF EXISTS "net"."cpe_firmware";
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "net"."cpe_firmware" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "vendor" VARCHAR(100) NOT NULL,
  "model_pattern" VARCHAR(100),
  "version" VARCHAR(100) NOT NULL,
  "object_key" VARCHAR(500) NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "file_size_bytes" BIGINT NOT NULL,
  "uploaded_by" VARCHAR(100),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_cpe_firmware_vendor" ON "net"."cpe_firmware" ("vendor");
