-- ==============================================================================
-- MIGRACIÓN 057: Estados EN_GRACIA / VENCIDA persistidos en la factura (Fase 2
-- del plan de ciclo de vida de facturación) — antes "en gracia"/"vencida" eran
-- solo cálculos al vuelo sobre PENDING_PAYMENT + dueDate; ahora son estados
-- reales de la máquina de estados de la factura, con sus fechas guardadas.
-- Esquema afectado: pos.invoices
-- ==============================================================================

DO $$ BEGIN
  ALTER TYPE "pos"."invoices_status_enum" ADD VALUE IF NOT EXISTS 'EN_GRACIA';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "pos"."invoices_status_enum" ADD VALUE IF NOT EXISTS 'VENCIDA';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "pos"."invoices"
  ADD COLUMN IF NOT EXISTS "grace_period_started_at" DATE,
  ADD COLUMN IF NOT EXISTS "grace_period_ends_at" DATE,
  ADD COLUMN IF NOT EXISTS "days_overdue" INT NOT NULL DEFAULT 0;
