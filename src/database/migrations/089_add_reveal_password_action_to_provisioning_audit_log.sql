-- ==============================================================================
-- MIGRACIÓN 089: acción REVEAL_PASSWORD en net.provisioning_audit_log
-- NetworkProvisioningService.revealPppoePassword() permite a ADMIN/GERENTE
-- ver en texto plano la contraseña PPPoE guardada de un contrato (antes
-- nunca se devolvía, ver ConfigureNetworkAccessModal). Cada revelado queda
-- auditado con esta acción nueva para poder responder "¿quién vio la
-- contraseña de este cliente y cuándo?".
-- Rollback manual:
--   No se puede quitar un valor de un ENUM de Postgres sin recrear el tipo;
--   si algún día hace falta revertir, recrear "provisioning_audit_log_action_enum"
--   sin 'REVEAL_PASSWORD' y migrar las filas existentes a otro valor primero.
-- ==============================================================================

DO $$ BEGIN
  ALTER TYPE "net"."provisioning_audit_log_action_enum" ADD VALUE IF NOT EXISTS 'REVEAL_PASSWORD';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
