-- ==============================================================================
-- MIGRACIÓN 007: Soporte de herramientas de trabajo (TOOL_ASSET) en el motor de
-- equipos serializados.
--
-- Una herramienta (fusionadora, OTDR, escalera) no tiene dirección MAC como los
-- CPE. La constraint UNIQUE existente sobre mac_address ya permite múltiples
-- NULL en Postgres, así que basta con quitar el NOT NULL — no se toca la
-- constraint de unicidad.
--
-- El identificador (serial_number) se mantiene obligatorio: para una herramienta
-- sin serial de fábrica, el almacenista le asigna un código de activo interno
-- (ej. "HERR-00042") en ese mismo campo.
-- ==============================================================================

ALTER TABLE "inv"."serial_numbers"
  ALTER COLUMN "mac_address" DROP NOT NULL;
