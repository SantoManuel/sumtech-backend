-- ==============================================================================
-- MIGRACIÓN 098: net.onu_service_config.service_vlan_id pasa a NULLABLE
-- Equipos detectedBy='OLT_IMPORT' (producción real, cableados en la OLT por
-- fuera de este sistema -- NUNCA hay que re-autorizarlos) no tienen ninguna
-- fila en onu_service_config todavía, y acciones que no re-cablean VLAN (ej.
-- "Solo actualizar ACS", updateTr069AcsUrl) necesitan poder crear una fila
-- mínima sin conocer la VLAN real. Todo el código que lee serviceVlanId ya
-- lo trata como opcional (`if (config.serviceVlanId)`) -- la columna era la
-- única pieza todavía forzando NOT NULL.
-- Rollback manual:
--   UPDATE "net"."onu_service_config" SET "service_vlan_id" = (SELECT id FROM "net"."vlans" LIMIT 1) WHERE "service_vlan_id" IS NULL;
--   ALTER TABLE "net"."onu_service_config" ALTER COLUMN "service_vlan_id" SET NOT NULL;
-- ==============================================================================

ALTER TABLE "net"."onu_service_config" ALTER COLUMN "service_vlan_id" DROP NOT NULL;
