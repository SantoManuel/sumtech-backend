-- ==============================================================================
-- MIGRACIÓN 103: Agregar 'supports_ethuni_dhcp_delegation' a net.onu_types
-- Algunos modelos de ONU (ej. HUAWEY-BT546XG) rechazan por OMCI el comando
-- "dhcp-ip ethuni eth_0/N from-onu" con "%Code 63993-GPONRM : ONT return
-- error:unknown ME" -- su firmware no implementa esa Managed Entity, a
-- diferencia de otros modelos ya confirmados en vivo (ZTE-F660, X2251) donde
-- ese mismo comando sí es aceptado y necesario. Default TRUE para no alterar
-- el comportamiento de ningún modelo ya funcionando.
-- ==============================================================================

ALTER TABLE "net"."onu_types"
  ADD COLUMN IF NOT EXISTS "supports_ethuni_dhcp_delegation" BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN "net"."onu_types"."supports_ethuni_dhcp_delegation" IS
  'Si el firmware OMCI de este modelo acepta "dhcp-ip ethuni eth_0/N from-onu". FALSE para modelos que lo rechazan con "unknown ME" (ej. HUAWEY-BT546XG) -- el driver omite esas líneas del script de autorización/TR-069 cuando es FALSE.';

UPDATE "net"."onu_types"
SET "supports_ethuni_dhcp_delegation" = FALSE
WHERE "vendor_type_name" = 'HUAWEY-BT546XG-TR069';
