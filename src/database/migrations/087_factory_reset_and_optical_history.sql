-- Migración 087: Agregar FACTORY_RESET a auditoría GenieACS y crear tabla de histórico óptico para ONUs

-- 1. Agregar 'FACTORY_RESET' al tipo enum de auditoría GenieACS si existe
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'genieacs_audit_log_action_enum') THEN
    ALTER TYPE "net"."genieacs_audit_log_action_enum" ADD VALUE IF NOT EXISTS 'FACTORY_RESET';
  END IF;
END $$;

-- 2. Crear tabla para almacenamiento de histórico de telemetría óptica de ONUs
CREATE TABLE IF NOT EXISTS "net"."onu_optical_history" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "onu_id" UUID NOT NULL REFERENCES "net"."onus"("id") ON DELETE CASCADE,
  "rx_power_dbm" NUMERIC(5, 2),
  "tx_power_dbm" NUMERIC(5, 2),
  "attenuation_db" NUMERIC(5, 2),
  "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_onu_optical_history_onu_recorded" 
  ON "net"."onu_optical_history" ("onu_id", "recorded_at" DESC);
