-- ==============================================================================
-- MIGRACIÓN 043: acción SYNC_PROFILE en net.provisioning_audit_log (Fase 07)
-- NetworkProvisioningService.syncProfileForContract() crea/actualiza el
-- perfil de velocidad en el nodo real y lo asigna al secreto del cliente
-- (RouterOsProvisioningAdapter.syncProfile) — cada corrida queda auditada
-- con esta acción nueva, distinta de PROVISION/SUSPEND/RESTORE/DEPROVISION
-- porque no cambia connectionStatus, solo la velocidad asignada.
-- Rollback manual:
--   No se puede quitar un valor de un ENUM de Postgres sin recrear el tipo;
--   si algún día hace falta revertir, recrear "provisioning_audit_log_action_enum"
--   sin 'SYNC_PROFILE' y migrar las filas existentes a otro valor primero.
-- ==============================================================================

DO $$ BEGIN
  ALTER TYPE "net"."provisioning_audit_log_action_enum" ADD VALUE IF NOT EXISTS 'SYNC_PROFILE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
