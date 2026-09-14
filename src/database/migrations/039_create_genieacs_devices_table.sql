-- ==============================================================================
-- MIGRACIÓN 039: Vínculo Contrato ↔ ONU/CPE (GenieACS) — Fase 01 integración GenieACS
-- Hasta ahora no existía ninguna forma de saber qué deviceId de GenieACS le
-- corresponde a cada contrato — el servidor GenieACS ya existe (con su propio
-- stack Docker) pero nunca estuvo conectado al ERP. Esta tabla es el satélite
-- 1–1 del contrato (mismo patrón que net.network_access para RouterOS/Mikrotik):
-- guarda el deviceId real ya resuelto contra la NBI, el equipo de inventario
-- (inv.serial_numbers) del que se derivó, y el estado de telemetría cacheado
-- (SSID, potencia óptica, último Inform) para no tener que consultar la NBI
-- en cada pantalla del ERP.
-- Esquema: net.genieacs_devices
-- Rollback manual:
--   DROP TABLE IF EXISTS "net"."genieacs_devices";
--   DROP SCHEMA IF EXISTS "net"; -- solo si no hay ninguna otra tabla usando este esquema
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS "net";

CREATE TABLE IF NOT EXISTS "net"."genieacs_devices" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL UNIQUE REFERENCES "com"."contracts"("id") ON DELETE CASCADE,
  "serial_number_id" UUID REFERENCES "inv"."serial_numbers"("id") ON DELETE SET NULL,
  "genieacs_device_id" VARCHAR(255) UNIQUE,
  "ssid" VARCHAR(32),
  "ssid_5g" VARCHAR(32),
  "last_inform_at" TIMESTAMP WITH TIME ZONE,
  "optical_rx_power_dbm" NUMERIC(6, 2),
  "last_reboot_at" TIMESTAMP WITH TIME ZONE,
  "last_sync_at" TIMESTAMP WITH TIME ZONE,
  "last_sync_error" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_genieacs_devices_serial_number_id" ON "net"."genieacs_devices" ("serial_number_id");
