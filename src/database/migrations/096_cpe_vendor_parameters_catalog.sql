-- ==============================================================================
-- MIGRACIÓN 096: catálogo de parámetros TR-069 verificados por fabricante/modelo
-- Security (§3.12) y Miscellaneous (§3.14) del plan son, por naturaleza,
-- extensiones de fabricante sin OID estándar -- en vez de adivinar rutas no
-- confirmadas (riesgo real: un fault silencioso o, peor, escribir el
-- parámetro equivocado), se guarda acá SOLO lo que alguien del equipo
-- confirmó en vivo contra un equipo real de ese vendor/modelo. La tabla nace
-- vacía a propósito -- se puebla operativamente, modelo por modelo, mismo
-- criterio ya usado para ZTE/HiOSO en el resto del proyecto.
-- Rollback manual:
--   DROP TABLE IF EXISTS "net"."cpe_vendor_parameters";
--   DROP TYPE IF EXISTS "net"."cpe_vendor_parameters_category_enum";
-- ==============================================================================

DO $$ BEGIN
  CREATE TYPE "net"."cpe_vendor_parameters_category_enum" AS ENUM ('SECURITY', 'MISCELLANEOUS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "net"."cpe_vendor_parameters" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Se compara contra `_deviceId._Manufacturer` (case-insensitive).
  "vendor" VARCHAR(100) NOT NULL,
  -- Substring contra ProductClass/ModelName -- NULL = aplica a cualquier modelo de ese vendor.
  "model_pattern" VARCHAR(100),
  "category" "net"."cpe_vendor_parameters_category_enum" NOT NULL,
  "parameter_key" VARCHAR(100) NOT NULL,
  "label" VARCHAR(150) NOT NULL,
  "oid_path" VARCHAR(500) NOT NULL,
  "data_type" VARCHAR(20) NOT NULL DEFAULT 'xsd:boolean',
  "notes" TEXT,
  "created_by" VARCHAR(100),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_cpe_vendor_parameters_vendor" ON "net"."cpe_vendor_parameters" ("vendor");
