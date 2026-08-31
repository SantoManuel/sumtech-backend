-- ==============================================================================
-- MIGRACIÓN 003: Trazabilidad de equipos (almacén / técnico / cliente) + materiales
-- a granel. Esquema: inv.*
--
-- Notas de compatibilidad:
-- - Los bloques DO $$ ... EXCEPTION WHEN duplicate_object/undefined_object THEN NULL
--   hacen la migración idempotente y tolerante a entornos donde `synchronize`
--   (TypeORM) ya haya creado parte del esquema en desarrollo.
-- - Los nuevos tipos ENUM (serial_numbers_location_type_enum, etc.) se crean con
--   TODOS sus valores desde el inicio, por lo que pueden usarse de inmediato en
--   esta misma migración (a diferencia de agregar valores a un enum ya existente).
-- ==============================================================================

-- 1. Almacenes ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "inv"."warehouses" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL UNIQUE,
  "address" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO "inv"."warehouses" ("name", "address")
SELECT 'Almacén Central', 'Sede principal de operaciones'
WHERE NOT EXISTS (SELECT 1 FROM "inv"."warehouses");

-- 2. Nuevos ejes de estado en inv.serial_numbers (EquipmentItem) ----------------

DO $$ BEGIN
  CREATE TYPE "inv"."serial_numbers_location_type_enum" AS ENUM
    ('WAREHOUSE', 'TECHNICIAN', 'CLIENT', 'REPAIR_VENDOR', 'RETIRED', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "inv"."serial_numbers_condition_enum" AS ENUM
    ('NEW', 'GOOD', 'DAMAGED', 'DEFECTIVE', 'IN_REPAIR', 'SCRAPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "inv"."serial_numbers"
  ADD COLUMN IF NOT EXISTS "location_type" "inv"."serial_numbers_location_type_enum" NOT NULL DEFAULT 'WAREHOUSE',
  ADD COLUMN IF NOT EXISTS "condition" "inv"."serial_numbers_condition_enum" NOT NULL DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS "current_warehouse_id" UUID,
  ADD COLUMN IF NOT EXISTS "current_employee_id" UUID,
  ADD COLUMN IF NOT EXISTS "current_contract_id" UUID,
  ADD COLUMN IF NOT EXISTS "last_movement_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE "inv"."serial_numbers"
    ADD CONSTRAINT "fk_serial_numbers_warehouse" FOREIGN KEY ("current_warehouse_id")
    REFERENCES "inv"."warehouses"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "inv"."serial_numbers"
    ADD CONSTRAINT "fk_serial_numbers_employee" FOREIGN KEY ("current_employee_id")
    REFERENCES "sec"."employees"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "inv"."serial_numbers"
    ADD CONSTRAINT "fk_serial_numbers_contract" FOREIGN KEY ("current_contract_id")
    REFERENCES "com"."contracts"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill de filas existentes a partir del enum legacy `status`.
-- NOTA: los casos DAMAGED/IN_REPAIR previos no permiten deducir con certeza si el
-- equipo está físicamente en almacén o con un técnico; quedan en almacén como
-- supuesto conservador y deben confirmarse con un conteo físico (ver reporte de
-- reconciliación sugerido en la documentación de la Fase 0).
--
-- CRÍTICO: guardado con WHERE last_movement_at IS NULL para que sea estrictamente
-- de una sola vez. Sin este guard, volver a ejecutar esta migración (p.ej. porque
-- apply-migrations.ts no llevaba registro de migraciones ya aplicadas) sobreescribe
-- con datos legacy cualquier equipo que ya haya sido movido por el motor nuevo,
-- dejándolo en un estado híbrido inconsistente (bug real detectado y corregido).
UPDATE "inv"."serial_numbers"
SET
  "location_type" = CASE
    WHEN "status" = 'ASSIGNED_TO_CLIENT' THEN 'CLIENT'
    WHEN "status" = 'IN_REPAIR' THEN 'REPAIR_VENDOR'
    ELSE 'WAREHOUSE'
  END::"inv"."serial_numbers_location_type_enum",
  "condition" = CASE
    WHEN "status" = 'DAMAGED' THEN 'DAMAGED'
    WHEN "status" = 'IN_REPAIR' THEN 'IN_REPAIR'
    WHEN "status" = 'ASSIGNED_TO_CLIENT' THEN 'GOOD'
    ELSE 'NEW'
  END::"inv"."serial_numbers_condition_enum",
  "current_warehouse_id" = CASE
    WHEN "status" IN ('AVAILABLE', 'RESERVED', 'DAMAGED') THEN (SELECT "id" FROM "inv"."warehouses" ORDER BY "created_at" ASC LIMIT 1)
    ELSE NULL
  END,
  "last_movement_at" = NOW()
WHERE "last_movement_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_serial_numbers_location" ON "inv"."serial_numbers" ("location_type", "current_employee_id");
CREATE INDEX IF NOT EXISTS "idx_serial_numbers_client" ON "inv"."serial_numbers" ("client_id");

-- 3. Kardex de equipos serializados (append-only) --------------------------------

DO $$ BEGIN
  CREATE TYPE "inv"."equipment_movements_movement_type_enum" AS ENUM
    ('INGRESO_ALMACEN', 'ASIGNAR_A_TECNICO', 'INSTALAR_EN_CLIENTE', 'DESINSTALAR',
     'DEVOLVER_A_ALMACEN', 'TRANSFERIR_A_OTRO_TECNICO', 'REPORTAR_DANO',
     'ENVIAR_A_REPARACION', 'RETORNAR_DE_REPARACION', 'DAR_DE_BAJA', 'AJUSTE_CONTEO_FISICO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "inv"."equipment_movements" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "equipment_item_id" UUID NOT NULL REFERENCES "inv"."serial_numbers"("id") ON DELETE CASCADE,
  "movement_type" "inv"."equipment_movements_movement_type_enum" NOT NULL,
  "from_location_type" "inv"."serial_numbers_location_type_enum",
  "from_warehouse_id" UUID,
  "from_employee_id" UUID,
  "from_client_id" UUID,
  "from_contract_id" UUID,
  "to_location_type" "inv"."serial_numbers_location_type_enum" NOT NULL,
  "to_warehouse_id" UUID,
  "to_employee_id" UUID,
  "to_client_id" UUID,
  "to_contract_id" UUID,
  "condition_before" "inv"."serial_numbers_condition_enum",
  "condition_after" "inv"."serial_numbers_condition_enum" NOT NULL,
  "ticket_id" UUID REFERENCES "tickets"."tickets"("id") ON DELETE SET NULL,
  "performed_by_user_id" UUID NOT NULL REFERENCES "sec"."users"("id"),
  "reason" VARCHAR(255),
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_equipment_movements_item_date"
  ON "inv"."equipment_movements" ("equipment_item_id", "created_at" DESC);

-- 4. Materiales a granel en poder de técnicos ------------------------------------

CREATE TABLE IF NOT EXISTS "inv"."stock_items" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL REFERENCES "inv"."products"("id") ON DELETE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "sec"."employees"("id") ON DELETE CASCADE,
  "quantity" DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK ("quantity" >= 0),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_stock_items_product_employee" UNIQUE ("product_id", "employee_id")
);

CREATE INDEX IF NOT EXISTS "idx_stock_items_employee" ON "inv"."stock_items" ("employee_id");

-- 5. Kardex de consumibles: nuevos tipos de movimiento + referencias a técnico/ticket

ALTER TABLE "inv"."stock_movements"
  ADD COLUMN IF NOT EXISTS "employee_id" UUID,
  ADD COLUMN IF NOT EXISTS "ticket_id" UUID;

DO $$ BEGIN
  ALTER TABLE "inv"."stock_movements"
    ADD CONSTRAINT "fk_stock_movements_employee" FOREIGN KEY ("employee_id")
    REFERENCES "sec"."employees"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "inv"."stock_movements"
    ADD CONSTRAINT "fk_stock_movements_ticket" FOREIGN KEY ("ticket_id")
    REFERENCES "tickets"."tickets"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "inv"."stock_movements_movement_type_enum" ADD VALUE IF NOT EXISTS 'OUT_TO_TECHNICIAN';
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "inv"."stock_movements_movement_type_enum" ADD VALUE IF NOT EXISTS 'IN_RETURN_FROM_TECHNICIAN';
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "inv"."stock_movements_movement_type_enum" ADD VALUE IF NOT EXISTS 'OUT_CONSUMED_INSTALLATION';
EXCEPTION WHEN undefined_object THEN NULL; END $$;
