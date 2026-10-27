-- ==============================================================================
-- MIGRACIÓN 102: Agregar columnas 'name' y 'description' a net.onus
-- Permite almacenar el nombre de abonado/cliente y descripción asignados
-- directamente en la cabecera OLT (ej. "name Test_3", "description zone_Azua_..."),
-- indexándolos para el buscador 360° incluso si la ONU aún no tiene contrato en CRM.
-- ==============================================================================

ALTER TABLE "net"."onus" ADD COLUMN IF NOT EXISTS "name" VARCHAR(150);
ALTER TABLE "net"."onus" ADD COLUMN IF NOT EXISTS "description" TEXT;

CREATE INDEX IF NOT EXISTS "idx_onus_name" ON "net"."onus" ("name");
CREATE INDEX IF NOT EXISTS "idx_onus_serial_number" ON "net"."onus" ("serial_number");
CREATE INDEX IF NOT EXISTS "idx_onus_mac" ON "net"."onus" ("mac");
CREATE INDEX IF NOT EXISTS "idx_onus_onu_index" ON "net"."onus" ("onu_index");

COMMENT ON COLUMN "net"."onus"."name" IS 'Nombre o identificador del abonado/servicio asignado en la OLT (name en running-config)';
COMMENT ON COLUMN "net"."onus"."description" IS 'Descripción, zona o notas de la ONU asignadas en la OLT';
