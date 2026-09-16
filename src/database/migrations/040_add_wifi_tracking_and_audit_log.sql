-- ==============================================================================
-- MIGRACIÓN 040: Auditoría de acciones ONU y rastreo de cambios de WiFi
-- Fase 02 de la integración GenieACS: el cliente ya puede cambiar el SSID/
-- clave de su WiFi desde el portal — esta migración agrega (1) una marca de
-- tiempo del último cambio de WiFi por contrato, para poder limitar la
-- frecuencia (máx. 1 cambio cada 10 min, evita ciclos de reinicio del CPE
-- por error o abuso) y (2) una tabla de auditoría — mismo espíritu que
-- net.provisioning_audit_log del módulo de red Mikrotik — para poder
-- responder "¿quién cambió el WiFi de este cliente y cuándo?".
-- Esquema: net.genieacs_audit_log
-- Rollback manual:
--   ALTER TABLE "net"."genieacs_devices" DROP COLUMN IF EXISTS "last_wifi_change_at";
--   DROP TABLE IF EXISTS "net"."genieacs_audit_log";
--   DROP TYPE IF EXISTS "net"."genieacs_audit_log_action_enum";
--   DROP TYPE IF EXISTS "net"."genieacs_audit_log_result_enum";
-- ==============================================================================

ALTER TABLE "net"."genieacs_devices" ADD COLUMN IF NOT EXISTS "last_wifi_change_at" TIMESTAMP WITH TIME ZONE;

DO $$ BEGIN
  CREATE TYPE "net"."genieacs_audit_log_action_enum" AS ENUM ('WIFI_CHANGE', 'REBOOT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "net"."genieacs_audit_log_result_enum" AS ENUM ('OK', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "net"."genieacs_audit_log" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "genieacs_device_id" VARCHAR(255),
  "action" "net"."genieacs_audit_log_action_enum" NOT NULL,
  "actor" VARCHAR(100) NOT NULL DEFAULT 'CLIENTE',
  "result" "net"."genieacs_audit_log_result_enum" NOT NULL,
  "error_message" TEXT,
  "old_ssid" VARCHAR(32),
  "new_ssid" VARCHAR(32),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_genieacs_audit_log_contract_id" ON "net"."genieacs_audit_log" ("contract_id");
