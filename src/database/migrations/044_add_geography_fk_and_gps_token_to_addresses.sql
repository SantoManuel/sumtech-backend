-- 044_add_geography_fk_and_gps_token_to_addresses.sql
-- Normaliza sector/municipio/provincia/país de com.addresses contra el esquema
-- geo.* (mismo patrón que 013 aplicó a inv.warehouses), y agrega la tabla de
-- solicitudes de ubicación GPS por enlace compartido con el cliente.
--
-- Las columnas varchar sector/municipality/city de com.addresses NO se eliminan:
-- se leen directamente (no solo por join) en el PDF de contrato, el PDF/ticket
-- de factura y varias pantallas del frontend, además del fallback de
-- geocodificación por texto en los mapas de tickets. Pasan a ser copias de
-- texto denormalizadas que el backend sincroniza cuando se resuelve un sectorId.

ALTER TABLE "com"."addresses"
    ADD COLUMN IF NOT EXISTS "country_id" UUID REFERENCES "geo"."countries"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "province_id" UUID REFERENCES "geo"."provinces"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "municipality_id" UUID REFERENCES "geo"."municipalities"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "sector_id" UUID REFERENCES "geo"."sectors"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_addresses_sector_id" ON "com"."addresses"("sector_id");

-- Solicitudes de ubicación GPS por enlace: el cliente abre el enlace en su
-- propio celular y comparte su ubicación real, sin necesidad de que el agente
-- esté físicamente presente. Token de un solo uso, expira a las 24h.
CREATE TABLE IF NOT EXISTS "com"."address_gps_requests" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "address_id" UUID NOT NULL REFERENCES "com"."addresses"("id") ON DELETE CASCADE,
    "token" VARCHAR(64) NOT NULL UNIQUE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "submitted_at" TIMESTAMP WITH TIME ZONE,
    "submitted_latitude" DECIMAL(10, 7),
    "submitted_longitude" DECIMAL(10, 7),
    "submitted_accuracy" DECIMAL(10, 2),
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "chk_address_gps_requests_status" CHECK ("status" IN ('PENDING', 'SUBMITTED', 'EXPIRED'))
);

CREATE INDEX IF NOT EXISTS "idx_address_gps_requests_address" ON "com"."address_gps_requests"("address_id");
