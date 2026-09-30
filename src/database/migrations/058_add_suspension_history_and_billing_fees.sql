-- ==============================================================================
-- MIGRACIÓN 058: Historial de suspensión + Reconexión con cargo (Fase 3 del
-- plan de ciclo de vida de facturación) — hoy la suspensión solo vive como un
-- evento efímero (ContractSuspendedEvent), sin ningún rastro persistente
-- consultable para auditoría o historial de cliente. También agrega el monto
-- configurable del cargo de reconexión y el tope de descuento sin autorización
-- de supervisor (Fase 4), ambos en com.billing_settings junto al resto de la
-- configuración de morosidad ya existente.
-- Esquemas afectados: com.billing_settings, com.suspension_history (nueva),
-- pos.sale_details
-- ==============================================================================

-- 1. com.billing_settings: nuevos montos configurables --------------------------
ALTER TABLE "com"."billing_settings"
  ADD COLUMN IF NOT EXISTS "reconnection_fee_amount" DECIMAL(10,2) NOT NULL DEFAULT 500.00,
  ADD COLUMN IF NOT EXISTS "cashier_discount_cap_amount" DECIMAL(10,2) NOT NULL DEFAULT 500.00;

-- 2. com.suspension_history: un registro por episodio de suspensión -------------
CREATE TABLE IF NOT EXISTS "com"."suspension_history" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "suspended_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "reason" TEXT NOT NULL,
  "related_invoice_id" UUID,
  "triggered_by_user_id" UUID,
  "triggered_by_process" VARCHAR(30),
  "observation" TEXT,
  "reconnected_at" TIMESTAMP WITH TIME ZONE,
  "reconnected_by_user_id" UUID,
  "reconnection_fee_invoice_id" UUID,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "chk_suspension_history_process" CHECK (
    "triggered_by_process" IS NULL OR "triggered_by_process" IN ('CRON_MOROSIDAD', 'MANUAL')
  )
);

DO $$ BEGIN
  ALTER TABLE "com"."suspension_history"
    ADD CONSTRAINT "fk_suspension_history_contract" FOREIGN KEY ("contract_id") REFERENCES "com"."contracts"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "com"."suspension_history"
    ADD CONSTRAINT "fk_suspension_history_client" FOREIGN KEY ("client_id") REFERENCES "com"."clients"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "com"."suspension_history"
    ADD CONSTRAINT "fk_suspension_history_related_invoice" FOREIGN KEY ("related_invoice_id") REFERENCES "pos"."invoices"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "com"."suspension_history"
    ADD CONSTRAINT "fk_suspension_history_reconnection_invoice" FOREIGN KEY ("reconnection_fee_invoice_id") REFERENCES "pos"."invoices"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "com"."suspension_history"
    ADD CONSTRAINT "fk_suspension_history_triggered_by" FOREIGN KEY ("triggered_by_user_id") REFERENCES "sec"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "com"."suspension_history"
    ADD CONSTRAINT "fk_suspension_history_reconnected_by" FOREIGN KEY ("reconnected_by_user_id") REFERENCES "sec"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Índice para encontrar rápido "la suspensión abierta" de un contrato
-- (reconnected_at IS NULL) y para el historial completo por cliente.
CREATE INDEX IF NOT EXISTS "idx_suspension_history_contract_open"
  ON "com"."suspension_history" ("contract_id", "reconnected_at");
CREATE INDEX IF NOT EXISTS "idx_suspension_history_client"
  ON "com"."suspension_history" ("client_id");

-- 3. pos.sale_details: nuevo tipo de ítem para el cargo de reconexión -----------
DO $$ BEGIN
  ALTER TYPE "pos"."sale_details_item_type_enum" ADD VALUE IF NOT EXISTS 'RECONNECTION_FEE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
