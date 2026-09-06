-- Migracion 011: Elimina vehicle_label de inv.dispatches
ALTER TABLE "inv"."dispatches"
  DROP COLUMN IF EXISTS "vehicle_label";
