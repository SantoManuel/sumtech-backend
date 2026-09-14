-- ==============================================================================
-- MIGRACIÓN 041: acción SHADOW_CHECK en net.provisioning_audit_log (Fase 05)
-- El modo sombra de RouterOsShadowSyncService compara el estado real de un
-- nodo Mikrotik contra net.network_access sin aplicar ningún cambio; cada
-- comparación (coincide o está desincronizada) se audita con esta acción
-- nueva, distinta de CREATE/PROVISION/SUSPEND/RESTORE/DEPROVISION porque no
-- es una transición de estado, es solo una lectura comparativa.
-- Rollback manual:
--   No se puede quitar un valor de un ENUM de Postgres sin recrear el tipo;
--   si algún día hace falta revertir, recrear "provisioning_audit_log_action_enum"
--   sin 'SHADOW_CHECK' y migrar las filas existentes a otro valor primero.
-- ==============================================================================

DO $$ BEGIN
  ALTER TYPE "net"."provisioning_audit_log_action_enum" ADD VALUE IF NOT EXISTS 'SHADOW_CHECK';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
