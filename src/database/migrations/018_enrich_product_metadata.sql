-- ==============================================================================
-- MIGRACIÓN 018: Enriquecimiento de Ficha Técnica de Inventario y Vinculación con Proveedores
-- Enfoque Operativo: Control de inventario corporativo, activos fijos, herramientas y comodato
-- ==============================================================================

-- 1. Agregar columnas a inv.products ----------------------------------------------
ALTER TABLE "inv"."products"
  ADD COLUMN IF NOT EXISTS "supplier_id" UUID,
  ADD COLUMN IF NOT EXISTS "unit_of_measure" VARCHAR(30) NOT NULL DEFAULT 'UNIDAD',
  ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "manufacturer_code" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "bin_location" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "warranty_months" INT DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "description" TEXT;

-- 2. Clave foránea hacia inv.suppliers --------------------------------------------
DO $$ BEGIN
  ALTER TABLE "inv"."products"
    ADD CONSTRAINT "fk_products_supplier" FOREIGN KEY ("supplier_id")
    REFERENCES "inv"."suppliers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Índices de Búsqueda y Optimización -------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_products_supplier_id" ON "inv"."products" ("supplier_id");
CREATE INDEX IF NOT EXISTS "idx_products_barcode" ON "inv"."products" ("barcode");
CREATE INDEX IF NOT EXISTS "idx_products_manufacturer_code" ON "inv"."products" ("manufacturer_code");

-- 4. Actualizar productos iniciales con sus proveedores y unidades correspondientes --
UPDATE "inv"."products" p
SET
  "supplier_id" = s."id",
  "unit_of_measure" = 'UNIDAD',
  "warranty_months" = 24,
  "description" = 'Equipo terminal ONT GPON Wi-Fi 6 para instalación en abonados en régimen de comodato.'
FROM "inv"."suppliers" s
WHERE s."rnc" = '1-31-88990-2' AND p."sku" = 'HW-ONU-AC1200';

UPDATE "inv"."products" p
SET
  "supplier_id" = s."id",
  "unit_of_measure" = 'UNIDAD',
  "warranty_months" = 24,
  "description" = 'Equipo terminal ONT GPON Dual Band para clientes residenciales y corporativos.'
FROM "inv"."suppliers" s
WHERE s."rnc" = '1-30-55443-1' AND p."sku" = 'ZTE-F670L-V9';

UPDATE "inv"."products" p
SET
  "supplier_id" = s."id",
  "unit_of_measure" = 'UNIDAD',
  "warranty_months" = 12,
  "description" = 'Decodificador Android TV 4K para servicio de televisión digital interactiva.'
FROM "inv"."suppliers" s
WHERE s."rnc" = '1-30-55443-1' AND p."sku" = 'STB-4K-AND';

UPDATE "inv"."products" p
SET
  "supplier_id" = s."id",
  "unit_of_measure" = 'METRO',
  "warranty_months" = 36,
  "description" = 'Cable de fibra óptica monomodo drop autosoportado para acometidas exteriores.'
FROM "inv"."suppliers" s
WHERE s."rnc" = '1-01-22334-5' AND p."sku" = 'CAB-FIBRA-DROP-1KM';

UPDATE "inv"."products" p
SET
  "supplier_id" = s."id",
  "unit_of_measure" = 'CAJA',
  "warranty_months" = 12,
  "description" = 'Conectores mecánicos pre-pulidos de ensamblaje rápido para empalmes en campo.'
FROM "inv"."suppliers" s
WHERE s."rnc" = '1-01-22334-5' AND p."sku" = 'CON-SCAPC-100';
