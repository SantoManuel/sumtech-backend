-- ==============================================================================
-- MIGRACIÓN 041: Estado online/offline cacheado por ONU
-- Fases 03/04 de la integración GenieACS: el panel de soporte del ERP y el
-- job de reconciliación periódica necesitan un estado online/offline que no
-- dependa de golpear la NBI en cada render — se deriva de `last_inform_at`
-- (ver genieacs-online-status.util.ts) y se cachea aquí en cada refresco.
-- Esquema: net.genieacs_devices
-- Rollback manual:
--   ALTER TABLE "net"."genieacs_devices" DROP COLUMN IF EXISTS "online_status";
--   DROP TYPE IF EXISTS "net"."genieacs_devices_online_status_enum";
-- ==============================================================================

DO $$ BEGIN
  CREATE TYPE "net"."genieacs_devices_online_status_enum" AS ENUM ('ONLINE', 'OFFLINE', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "net"."genieacs_devices"
  ADD COLUMN IF NOT EXISTS "online_status" "net"."genieacs_devices_online_status_enum" NOT NULL DEFAULT 'UNKNOWN';
