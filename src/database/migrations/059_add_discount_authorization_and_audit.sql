-- Migración 059: Soporte de auditoría y autorización de descuentos manuales en ventas y facturas
DO $$ BEGIN
  ALTER TABLE "pos"."sales" 
    ADD COLUMN IF NOT EXISTS "discount_type" VARCHAR(20) NOT NULL DEFAULT 'FIXED',
    ADD COLUMN IF NOT EXISTS "discount_percentage" DECIMAL(5,2) NULL,
    ADD COLUMN IF NOT EXISTS "discount_reason" TEXT NULL,
    ADD COLUMN IF NOT EXISTS "discount_authorized_by" UUID NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Constraint de clave foránea hacia sec.users (supervisor autorizador)
DO $$ BEGIN
  ALTER TABLE "pos"."sales"
    ADD CONSTRAINT "fk_sales_discount_authorized_by"
    FOREIGN KEY ("discount_authorized_by") REFERENCES "sec"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Índice para consultas de auditoría por supervisor
CREATE INDEX IF NOT EXISTS "idx_sales_discount_authorized_by" 
  ON "pos"."sales" ("discount_authorized_by") 
  WHERE "discount_authorized_by" IS NOT NULL;
