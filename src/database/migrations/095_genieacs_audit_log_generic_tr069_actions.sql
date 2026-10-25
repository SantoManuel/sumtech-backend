-- ==============================================================================
-- MIGRACIÓN 095: acciones genéricas TR-069 en net.genieacs_audit_log
-- La pestaña "TR-069 / GenieACS" de la Ficha 360 de ONU (ver
-- Plan_Implementacion_Pestana_TR069_Avanzada_ONU.md §4) agrega escritura real
-- sobre PPP/WiFi avanzado/DHCP/LAN Ports/Port Forward/Diagnósticos/Firmware --
-- seguir agregando una columna por campo (como "old_ssid"/"new_ssid") no
-- escala a 17 secciones. Esta migración agrega acciones genéricas + columnas
-- genéricas (parameter_path/old_value/new_value) que cualquier endpoint de
-- escritura nuevo puede usar sin otra migración. También relaja contract_id
-- a NULLABLE: los endpoints nuevos actúan sobre genieacs_device_id (la ficha
-- de ONU no siempre tiene un contrato vinculado todavía, ver "ONU activa sin
-- contrato vinculado" en dashboard/red/onus/[id]), y genieacs_device_id ya es
-- suficiente para auditar "qué se le cambió a este equipo y cuándo".
-- Rollback manual:
--   ALTER TABLE "net"."genieacs_audit_log" DROP COLUMN IF EXISTS "parameter_path";
--   ALTER TABLE "net"."genieacs_audit_log" DROP COLUMN IF EXISTS "old_value";
--   ALTER TABLE "net"."genieacs_audit_log" DROP COLUMN IF EXISTS "new_value";
--   ALTER TABLE "net"."genieacs_audit_log" ALTER COLUMN "contract_id" SET NOT NULL; (solo si no quedaron filas NULL)
--   No se puede quitar un valor de un ENUM de Postgres sin recrear el tipo.
-- ==============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'genieacs_audit_log_action_enum') THEN
    ALTER TYPE "net"."genieacs_audit_log_action_enum" ADD VALUE IF NOT EXISTS 'TR069_PARAMETER_CHANGE';
    ALTER TYPE "net"."genieacs_audit_log_action_enum" ADD VALUE IF NOT EXISTS 'PORT_FORWARD_ADD';
    ALTER TYPE "net"."genieacs_audit_log_action_enum" ADD VALUE IF NOT EXISTS 'PORT_FORWARD_DELETE';
    ALTER TYPE "net"."genieacs_audit_log_action_enum" ADD VALUE IF NOT EXISTS 'LAN_PORT_TOGGLE';
    ALTER TYPE "net"."genieacs_audit_log_action_enum" ADD VALUE IF NOT EXISTS 'DIAGNOSTIC_RUN';
    ALTER TYPE "net"."genieacs_audit_log_action_enum" ADD VALUE IF NOT EXISTS 'FIRMWARE_PUSH';
  END IF;
END $$;

ALTER TABLE "net"."genieacs_audit_log" ADD COLUMN IF NOT EXISTS "parameter_path" VARCHAR(500);
ALTER TABLE "net"."genieacs_audit_log" ADD COLUMN IF NOT EXISTS "old_value" TEXT;
ALTER TABLE "net"."genieacs_audit_log" ADD COLUMN IF NOT EXISTS "new_value" TEXT;
ALTER TABLE "net"."genieacs_audit_log" ALTER COLUMN "contract_id" DROP NOT NULL;
