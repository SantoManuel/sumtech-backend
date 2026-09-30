-- ==============================================================================
-- MIGRACIÓN 056: Soporte de Prorrateo (Fase 1 del plan de ciclo de vida de
-- facturación) — la primera factura de un contrato nuevo activado a mitad de
-- período se cobra proporcional a los días realmente usados, no el mes completo.
-- La política de días es configurable (no se asume una única fórmula permanente).
-- Esquemas afectados: com.billing_settings, pos.invoices
-- ==============================================================================

-- 1. com.billing_settings: política de conteo de días para el prorrateo --------
ALTER TABLE "com"."billing_settings"
  ADD COLUMN IF NOT EXISTS "proration_day_count_policy" VARCHAR(20) NOT NULL DEFAULT 'FIXED_30';

DO $$ BEGIN
  ALTER TABLE "com"."billing_settings"
    ADD CONSTRAINT "chk_billing_settings_proration_policy" CHECK (
      "proration_day_count_policy" IN ('FIXED_30', 'ACTUAL_MONTH_DAYS', 'CYCLE_DAYS')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. pos.invoices: metadatos de prorrateo, solo poblados en la factura inicial --
ALTER TABLE "pos"."invoices"
  ADD COLUMN IF NOT EXISTS "is_prorated" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "prorated_days" INT,
  ADD COLUMN IF NOT EXISTS "proration_day_count_policy" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "cycle_days" INT;
