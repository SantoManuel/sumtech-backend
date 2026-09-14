-- ==============================================================================
-- MIGRACIÓN 029: Nuevo tipo de notificación SERVICE_TERMINATED
-- ClientsService.terminateContract emite CONTRACT_TERMINATED, que
-- ContractStatusListener traduce en una notificación al cliente.
-- Esquema: com.client_notifications
-- ==============================================================================

DO $$ BEGIN
  ALTER TYPE "com"."client_notifications_type_enum" ADD VALUE IF NOT EXISTS 'SERVICE_TERMINATED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
