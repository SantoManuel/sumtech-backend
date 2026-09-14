-- ==============================================================================
-- MIGRACIÓN 020: Soporte de Facturación Recurrente (Suscripciones MRR)
-- Desacopla "pos"."invoices" de "pos"."sales": una factura ahora puede existir en
-- estado PENDING_PAYMENT sin venta ni NCF asignado. El NCF solo se reserva y se
-- timbra ante la DGII al momento del cobro (InvoicingService.settleInvoice, Fase 4),
-- lo cual preserva el correlativo secuencial exigido por la DGII.
-- Esquemas afectados: pos.invoices, com.plans, com.billing_settings (nueva),
-- public.dgii_received_invoices (nueva — corrige tabla nunca creada para
-- DgiiReceivedInvoice, entidad ya usada por DgiiB2bService pero ausente de migraciones).
-- ==============================================================================

-- 1. pos.invoices: relajar sale_id/ncf_number/ncf_type a NULLABLE --------------
ALTER TABLE "pos"."invoices"
  ALTER COLUMN "sale_id" DROP NOT NULL,
  ALTER COLUMN "ncf_number" DROP NOT NULL,
  ALTER COLUMN "ncf_type" DROP NOT NULL,
  ALTER COLUMN "ncf_type" DROP DEFAULT;

-- 2. pos.invoices: nuevo estado de ciclo de vida de la factura -----------------
DO $$ BEGIN
  CREATE TYPE "pos"."invoices_status_enum" AS ENUM ('PENDING_PAYMENT', 'ISSUED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "pos"."invoices"
  ADD COLUMN IF NOT EXISTS "status" "pos"."invoices_status_enum" NOT NULL DEFAULT 'ISSUED';

-- 3. pos.invoices: columnas propias de la factura (independientes de la venta) --
ALTER TABLE "pos"."invoices"
  ADD COLUMN IF NOT EXISTS "client_id" UUID,
  ADD COLUMN IF NOT EXISTS "contract_id" UUID,
  ADD COLUMN IF NOT EXISTS "subtotal" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "itbis_total" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "cdt_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "grand_total" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "due_date" DATE,
  ADD COLUMN IF NOT EXISTS "billing_period_start" DATE,
  ADD COLUMN IF NOT EXISTS "billing_period_end" DATE,
  ADD COLUMN IF NOT EXISTS "concept" TEXT,
  ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP WITH TIME ZONE;

-- 4. Backfill de filas existentes (todas fueron creadas junto a una venta ya pagada) --
UPDATE "pos"."invoices" i
SET
  "client_id" = s."client_id",
  "contract_id" = s."contract_id",
  "subtotal" = s."subtotal",
  "itbis_total" = s."itbis_total",
  "grand_total" = s."grand_total",
  "paid_at" = i."issued_at"
FROM "pos"."sales" s
WHERE i."sale_id" = s."id" AND i."client_id" IS NULL;

ALTER TABLE "pos"."invoices" ALTER COLUMN "client_id" SET NOT NULL;

-- 5. Llaves foráneas e índices ---------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "pos"."invoices"
    ADD CONSTRAINT "fk_invoices_client" FOREIGN KEY ("client_id") REFERENCES "com"."clients"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "pos"."invoices"
    ADD CONSTRAINT "fk_invoices_contract" FOREIGN KEY ("contract_id") REFERENCES "com"."contracts"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_invoices_client_status" ON "pos"."invoices" ("client_id", "status");
CREATE INDEX IF NOT EXISTS "idx_invoices_contract_status" ON "pos"."invoices" ("contract_id", "status");

-- Evita que el motor de facturación recurrente (Fase 2) genere dos veces la
-- factura de un mismo contrato para el mismo período, incluso ante condiciones
-- de carrera (protección a nivel de base de datos, no solo de aplicación).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoices_contract_period"
  ON "pos"."invoices" ("contract_id", "billing_period_start")
  WHERE "contract_id" IS NOT NULL;

-- 6. com.plans: CDT (2% telecomunicaciones), configurable por plan --------------
ALTER TABLE "com"."plans"
  ADD COLUMN IF NOT EXISTS "cdt_rate" DECIMAL(4,2) NOT NULL DEFAULT 0.02;

-- 7. com.billing_settings: configuración global de morosidad/recordatorios -----
CREATE TABLE IF NOT EXISTS "com"."billing_settings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "grace_days_before_suspension" INT NOT NULL DEFAULT 5,
  "reminder_days_after_due" INT NOT NULL DEFAULT 2,
  "advance_reminder_days_before_due" INT NOT NULL DEFAULT 3,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO "com"."billing_settings" ("grace_days_before_suspension", "reminder_days_after_due", "advance_reminder_days_before_due")
SELECT 5, 2, 3
WHERE NOT EXISTS (SELECT 1 FROM "com"."billing_settings");

-- 8. Corrige deuda técnica preexistente: DgiiReceivedInvoice se usa desde
--    DgiiB2bService pero su tabla nunca fue creada por ninguna migración.
CREATE TABLE IF NOT EXISTS "public"."dgii_received_invoices" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "rnc_emisor" VARCHAR(11) NOT NULL,
  "razon_social_emisor" VARCHAR(255),
  "rnc_comprador" VARCHAR(11) NOT NULL,
  "encf" VARCHAR(13) NOT NULL,
  "tipo_ecf" VARCHAR(2) NOT NULL,
  "monto_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "monto_exento" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_itbis" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "estado_acuse" SMALLINT NOT NULL DEFAULT 0,
  "motivo_rechazo" TEXT,
  "estado_aprobacion_comercial" SMALLINT NOT NULL DEFAULT 0,
  "xml_original" TEXT NOT NULL,
  "xml_signed_arecf" TEXT NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_dgii_received_invoices_rnc_emisor" ON "public"."dgii_received_invoices" ("rnc_emisor");
CREATE INDEX IF NOT EXISTS "idx_dgii_received_invoices_rnc_comprador" ON "public"."dgii_received_invoices" ("rnc_comprador");
CREATE INDEX IF NOT EXISTS "idx_dgii_received_invoices_encf" ON "public"."dgii_received_invoices" ("encf");
