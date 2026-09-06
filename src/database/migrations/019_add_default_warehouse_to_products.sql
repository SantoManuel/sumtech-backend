-- ==============================================================================
-- MIGRACIÓN 019: Vincular Almacén / Bodega por Defecto a la Ficha de Producto
-- ==============================================================================

-- 1. Agregar columna default_warehouse_id -----------------------------------------
ALTER TABLE "inv"."products"
  ADD COLUMN IF NOT EXISTS "default_warehouse_id" UUID;

-- 2. Clave foránea hacia inv.warehouses -------------------------------------------
DO $$ BEGIN
  ALTER TABLE "inv"."products"
    ADD CONSTRAINT "fk_products_default_warehouse" FOREIGN KEY ("default_warehouse_id")
    REFERENCES "inv"."warehouses"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Índice para optimizar consultas ----------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_products_default_warehouse" ON "inv"."products" ("default_warehouse_id");

-- 4. Asignar el almacén principal a los productos existentes ----------------------
UPDATE "inv"."products" p
SET "default_warehouse_id" = (
  SELECT w."id" FROM "inv"."warehouses" w
  WHERE w."is_active" = TRUE
  ORDER BY w."created_at" ASC
  LIMIT 1
)
WHERE p."default_warehouse_id" IS NULL;
