-- ==============================================================================
-- PLATFORM MIGRACIÓN 002: Campos de gestión administrativa de suscripciones
-- ==============================================================================

ALTER TABLE "platform"."saas_subscriptions" 
ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS "billing_notes" TEXT,
ADD COLUMN IF NOT EXISTS "last_payment_date" TIMESTAMP WITH TIME ZONE;
