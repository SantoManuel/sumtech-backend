-- ==============================================================================
-- MIGRACIÓN 006: Catálogo dinámico de categorías (reemplaza el enum fijo de
-- inv.products.category por inv.categories, agregando el eje "tipo de artículo"
-- que distingue equipo de cliente / herramienta / consumible).
--
-- Notas de compatibilidad:
-- - La columna legacy `category` (enum) de inv.products NO se elimina en esta
--   migración: queda de solo lectura hasta que todo el código (facturación,
--   portal de cliente) migre a `category_id`. Se elimina en una migración de
--   limpieza posterior, fuera de este alcance.
-- - Backfill guardado por `WHERE category_id IS NULL` para que sea de una sola
--   ejecución, igual que el backfill de la migración 003.
-- ==============================================================================

-- 1. Tipo de artículo + tabla de categorías --------------------------------------

DO $$ BEGIN
  CREATE TYPE "inv"."categories_article_type_enum" AS ENUM
    ('CUSTOMER_EQUIPMENT', 'TOOL_ASSET', 'CONSUMABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "inv"."categories" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" VARCHAR(50) NOT NULL UNIQUE,
  "name" VARCHAR(150) NOT NULL,
  "description" TEXT,
  "article_type" "inv"."categories_article_type_enum" NOT NULL,
  "default_requires_serial" BOOLEAN NOT NULL DEFAULT TRUE,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 2. Semilla de las 5 categorías que hoy viven como enum -------------------------

INSERT INTO "inv"."categories" ("code", "name", "article_type", "default_requires_serial")
SELECT * FROM (VALUES
  ('ROUTER_ONU', 'Router / ONU', 'CUSTOMER_EQUIPMENT'::"inv"."categories_article_type_enum", TRUE),
  ('SET_TOP_BOX', 'Set-Top Box', 'CUSTOMER_EQUIPMENT'::"inv"."categories_article_type_enum", TRUE),
  ('FIBER_CABLE', 'Cable de Fibra Óptica', 'CONSUMABLE'::"inv"."categories_article_type_enum", FALSE),
  ('CONNECTOR', 'Conectores', 'CONSUMABLE'::"inv"."categories_article_type_enum", FALSE),
  ('ACCESSORY', 'Accesorios', 'CONSUMABLE'::"inv"."categories_article_type_enum", FALSE)
) AS seed(code, name, article_type, default_requires_serial)
WHERE NOT EXISTS (SELECT 1 FROM "inv"."categories" WHERE "code" = seed.code);

-- 3. Vincular productos a su categoría -------------------------------------------

ALTER TABLE "inv"."products"
  ADD COLUMN IF NOT EXISTS "category_id" UUID;

DO $$ BEGIN
  ALTER TABLE "inv"."products"
    ADD CONSTRAINT "fk_products_category" FOREIGN KEY ("category_id")
    REFERENCES "inv"."categories"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE "inv"."products" p
SET "category_id" = c."id"
FROM "inv"."categories" c
WHERE p."category_id" IS NULL AND c."code" = p."category"::TEXT;

CREATE INDEX IF NOT EXISTS "idx_products_category" ON "inv"."products" ("category_id");
