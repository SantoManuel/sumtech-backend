-- ==============================================================================
-- MIGRACIÓN 061: Enriquecimiento de auditoría de aprovisionamiento de red (Fase 0)
-- Añade actor_user_id (UUID del usuario operador en lugar de solo actor string),
-- error_code para clasificación de incidencias (RF-RED-004) y node_id para reportes
-- por nodo de red.
-- ==============================================================================

ALTER TABLE "net"."provisioning_audit_log"
  ADD COLUMN IF NOT EXISTS "actor_user_id" UUID NULL,
  ADD COLUMN IF NOT EXISTS "error_code" VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS "node_id" UUID NULL;

CREATE INDEX IF NOT EXISTS "idx_provisioning_audit_log_actor_user_id" ON "net"."provisioning_audit_log" ("actor_user_id");
CREATE INDEX IF NOT EXISTS "idx_provisioning_audit_log_node_id" ON "net"."provisioning_audit_log" ("node_id");
CREATE INDEX IF NOT EXISTS "idx_provisioning_audit_log_error_code" ON "net"."provisioning_audit_log" ("error_code");
