-- ==============================================================================
-- MIGRACIÓN 021: Nuevo tipo de notificación INVOICE_GENERATED
-- El motor de facturación recurrente (BillingCycleService, Fase 2) notifica al
-- cliente cuando se genera una nueva factura PENDING_PAYMENT.
-- Esquema: com.client_notifications
-- ==============================================================================

DO $$ BEGIN
  ALTER TYPE "com"."client_notifications_type_enum" ADD VALUE IF NOT EXISTS 'INVOICE_GENERATED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
