-- ==============================================================================
-- MIGRACIÓN 040: Auditoría de aprovisionamiento de red (Fase 02 del módulo network)
-- Cada acción que NetworkProvisioningService ejecuta contra un acceso de red
-- (crear, activar, suspender, restaurar, cortar) queda registrada aquí con su
-- resultado. Hoy el adaptador activo es siempre ManualProvisioningAdapter (no
-- llama a ningún nodo real), pero la tabla ya está lista para cuando el
-- adaptador RouterOS real empiece a fallar/tener éxito de verdad — sin esta
-- auditoría, un reclamo de "me cortaron el servicio sin razón" no se puede
-- resolver.
-- Rollback manual:
--   DROP TABLE IF EXISTS "net"."provisioning_audit_log";
--   DROP TYPE IF EXISTS "net"."provisioning_audit_log_result_enum";
--   DROP TYPE IF EXISTS "net"."provisioning_audit_log_action_enum";
-- ==============================================================================

DO $$ BEGIN
  CREATE TYPE "net"."provisioning_audit_log_action_enum" AS ENUM ('CREATE', 'PROVISION', 'SUSPEND', 'RESTORE', 'DEPROVISION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "net"."provisioning_audit_log_result_enum" AS ENUM ('OK', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "net"."provisioning_audit_log" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "access_id" UUID NOT NULL REFERENCES "net"."network_access"("id") ON DELETE CASCADE,
  "contract_id" UUID NOT NULL,
  "action" "net"."provisioning_audit_log_action_enum" NOT NULL,
  "result" "net"."provisioning_audit_log_result_enum" NOT NULL,
  "error_message" TEXT,
  "actor" VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_provisioning_audit_log_access_id" ON "net"."provisioning_audit_log" ("access_id");
CREATE INDEX IF NOT EXISTS "idx_provisioning_audit_log_contract_id" ON "net"."provisioning_audit_log" ("contract_id");
