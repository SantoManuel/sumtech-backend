-- ==============================================================================
-- MIGRACIÓN 004: Corrige columnas faltantes en pos.sales (deuda técnica preexistente,
-- detectada durante la verificación end-to-end del flujo de instalación de equipos:
-- SaleEntity ya declaraba contract_id/billing_period/due_date/notes, pero la tabla
-- física nunca las tuvo porque no existía migración para ellas).
-- Esquema: pos.sales
-- ==============================================================================

ALTER TABLE "pos"."sales"
  ADD COLUMN IF NOT EXISTS "contract_id" UUID,
  ADD COLUMN IF NOT EXISTS "billing_period" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "due_date" DATE,
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

DO $$ BEGIN
  ALTER TABLE "pos"."sales"
    ADD CONSTRAINT "fk_sales_contract" FOREIGN KEY ("contract_id")
    REFERENCES "com"."contracts"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
