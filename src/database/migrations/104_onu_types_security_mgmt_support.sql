-- ==============================================================================
-- MIGRACIÓN 104: Agregar 'supports_security_mgmt' a net.onu_types
-- Algunos modelos de ONU (ej. HUAWEY-BT546XG) rechazan por OMCI las reglas
-- "security-mgmt 5/998/999 ..." con "%Code 63993-GPONRM : ONT return
-- error:unknown ME" -- su firmware no implementa esa Managed Entity, a
-- diferencia de otros modelos ya confirmados en vivo (ej. HUAWEI HG8546M,
-- ONU CMDCDD4D131E) donde esas mismas reglas sí son aceptadas. Estas reglas
-- solo habilitan acceso remoto HTTPS/SSH/Telnet/FTP/SNMP al router desde la
-- OLT -- no son necesarias para el registro TR-069 (eso depende solo del
-- cableado iphost 2/VEIP). Default TRUE para no alterar el comportamiento
-- de ningún modelo ya funcionando.
-- ==============================================================================

ALTER TABLE "net"."onu_types"
  ADD COLUMN IF NOT EXISTS "supports_security_mgmt" BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN "net"."onu_types"."supports_security_mgmt" IS
  'Si el firmware OMCI de este modelo acepta las reglas "security-mgmt ...". FALSE para modelos que las rechazan con "unknown ME" (ej. HUAWEY-BT546XG) -- el driver omite esas líneas del script de autorización/TR-069 cuando es FALSE.';

UPDATE "net"."onu_types"
SET "supports_security_mgmt" = FALSE
WHERE "vendor_type_name" = 'HUAWEY-BT546XG-TR069';
