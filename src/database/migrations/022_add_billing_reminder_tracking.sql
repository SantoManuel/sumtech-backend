-- ==============================================================================
-- MIGRACIÓN 022: Soporte de Morosidad (Fase 3)
-- Rastrea si ya se envió el recordatorio preventivo/de vencimiento de una factura
-- (evita reenvíos duplicados en corridas sucesivas del cron de morosidad) y agrega
-- los nuevos tipos de notificación de suspensión/reconexión de servicio.
-- Esquemas: pos.invoices, com.client_notifications
-- ==============================================================================

ALTER TABLE "pos"."invoices"
  ADD COLUMN IF NOT EXISTS "advance_reminder_sent_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "overdue_reminder_sent_at" TIMESTAMP WITH TIME ZONE;

DO $$ BEGIN
  ALTER TYPE "com"."client_notifications_type_enum" ADD VALUE IF NOT EXISTS 'SERVICE_SUSPENDED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "com"."client_notifications_type_enum" ADD VALUE IF NOT EXISTS 'SERVICE_REACTIVATED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
