-- ==============================================================================
-- 071_optimize_equipment_indexes.sql
-- Optimización de rendimiento e índices de alta escalabilidad para inv.serial_numbers
-- ==============================================================================

-- 1. Habilitar extensión trigram para acelerar consultas ILIKE '%search%'
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Índice Trigram GIN sobre número de serie
CREATE INDEX IF NOT EXISTS "idx_serial_numbers_serial_trgm" 
  ON "inv"."serial_numbers" USING gin ("serial_number" gin_trgm_ops);

-- 3. Índice Trigram GIN sobre dirección MAC
CREATE INDEX IF NOT EXISTS "idx_serial_numbers_mac_trgm" 
  ON "inv"."serial_numbers" USING gin ("mac_address" gin_trgm_ops);

-- 4. Índice compuesto para acelerar conteo y filtrado en trazabilidad de equipos
CREATE INDEX IF NOT EXISTS "idx_serial_numbers_lookup_compound" 
  ON "inv"."serial_numbers" ("product_id", "location_type", "condition");

-- 5. Índice B-Tree para acelerar ordenamiento ORDER BY s.serialNumber ASC
CREATE INDEX IF NOT EXISTS "idx_serial_numbers_order_asc" 
  ON "inv"."serial_numbers" ("serial_number" ASC);
