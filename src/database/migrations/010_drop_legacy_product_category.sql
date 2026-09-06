-- Migracion 010: Elimina columna legacy inv.products.category
ALTER TABLE "inv"."products"
  DROP COLUMN IF EXISTS "category";

DROP TYPE IF EXISTS "inv"."products_category_enum";
