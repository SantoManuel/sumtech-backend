-- ==============================================================================
-- MIGRACIÓN 009: Despacho de Inventario por Lotes (Manifiesto de Carga).
--
-- No requiere backfill: es una funcionalidad completamente nueva. El vehículo es
-- un campo descriptivo (placa/nombre) — no se crea una tabla de vehículos ni un
-- nuevo EquipmentLocationType, el equipo despachado sigue yendo a custodia
-- TECHNICIAN como ya lo hace `asignarATecnico`.
-- ==============================================================================

DO $$ BEGIN
  CREATE TYPE "inv"."dispatches_status_enum" AS ENUM ('DRAFT', 'DISPATCHED', 'ACCEPTED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "inv"."dispatches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "warehouse_id" UUID NOT NULL REFERENCES "inv"."warehouses"("id"),
  "technician_id" UUID NOT NULL REFERENCES "sec"."employees"("id"),
  "vehicle_label" VARCHAR(100),
  "status" "inv"."dispatches_status_enum" NOT NULL DEFAULT 'DRAFT',
  "created_by_user_id" UUID NOT NULL REFERENCES "sec"."users"("id"),
  "dispatched_at" TIMESTAMP WITH TIME ZONE,
  "responded_at" TIMESTAMP WITH TIME ZONE,
  "rejection_reason" VARCHAR(255),
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_dispatches_technician_status" ON "inv"."dispatches" ("technician_id", "status");

DO $$ BEGIN
  CREATE TYPE "inv"."dispatch_lines_line_type_enum" AS ENUM ('EQUIPMENT', 'CONSUMABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "inv"."dispatch_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "dispatch_id" UUID NOT NULL REFERENCES "inv"."dispatches"("id") ON DELETE CASCADE,
  "line_type" "inv"."dispatch_lines_line_type_enum" NOT NULL,
  "equipment_item_id" UUID REFERENCES "inv"."serial_numbers"("id"),
  "product_id" UUID REFERENCES "inv"."products"("id"),
  "quantity" DECIMAL(12, 2),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "chk_dispatch_lines_exclusive" CHECK (
    ("line_type" = 'EQUIPMENT' AND "equipment_item_id" IS NOT NULL AND "product_id" IS NULL AND "quantity" IS NULL)
    OR
    ("line_type" = 'CONSUMABLE' AND "product_id" IS NOT NULL AND "quantity" IS NOT NULL AND "equipment_item_id" IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS "idx_dispatch_lines_dispatch" ON "inv"."dispatch_lines" ("dispatch_id");
CREATE INDEX IF NOT EXISTS "idx_dispatch_lines_equipment" ON "inv"."dispatch_lines" ("equipment_item_id");
