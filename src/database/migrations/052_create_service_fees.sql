-- 052_create_service_fees.sql
-- Catálogo real de cargos de servicio puntuales (instalación, reparación)
-- cobrables desde el POS. Antes estos dos cargos ("Cargo de Instalación
-- Fibra GPON Residencial" RD$1,500, "Servicio Técnico de Reparación /
-- Reubicación de Fibra" RD$800) estaban hardcodeados como constantes en
-- sumtech-frontend/src/app/(dashboard)/dashboard/pos/page.tsx — cambiar un
-- precio exigía editar código y redesplegar, sin ningún rastro en base de
-- datos. Se insertan aquí con los mismos valores para no perder el catálogo
-- actual al migrar a producción.

CREATE TABLE IF NOT EXISTS "com"."service_fees" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "fee_type" VARCHAR(20) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "itbis_rate" DECIMAL(4,2) NOT NULL DEFAULT 0.18,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "chk_service_fees_fee_type" CHECK (
        "fee_type" IN ('INSTALLATION_FEE', 'REPAIR_FEE')
    )
);

CREATE INDEX IF NOT EXISTS "idx_service_fees_is_active"
    ON "com"."service_fees"("is_active");

INSERT INTO "com"."service_fees" ("name", "fee_type", "price", "itbis_rate")
VALUES
    ('Cargo de Instalación Fibra GPON Residencial', 'INSTALLATION_FEE', 1500.00, 0.18),
    ('Servicio Técnico de Reparación / Reubicación de Fibra', 'REPAIR_FEE', 800.00, 0.18);
