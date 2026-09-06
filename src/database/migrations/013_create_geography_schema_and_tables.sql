-- 013_create_geography_schema_and_tables.sql
-- Creación del esquema geográfico normalizado y extensión de almacenes

CREATE SCHEMA IF NOT EXISTS "geo";

-- 1. Países
CREATE TABLE IF NOT EXISTS "geo"."countries" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" VARCHAR(3) NOT NULL UNIQUE,
    "name" VARCHAR(100) NOT NULL UNIQUE,
    "phone_code" VARCHAR(10) NOT NULL DEFAULT '+1',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 2. Provincias / Estados / Departamentos
CREATE TABLE IF NOT EXISTS "geo"."provinces" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "country_id" UUID NOT NULL REFERENCES "geo"."countries"("id") ON DELETE CASCADE,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "uq_provinces_country_name" UNIQUE ("country_id", "name")
);

-- 3. Municipios
CREATE TABLE IF NOT EXISTS "geo"."municipalities" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "province_id" UUID NOT NULL REFERENCES "geo"."provinces"("id") ON DELETE CASCADE,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(10),
    "postal_code" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "uq_municipalities_province_name" UNIQUE ("province_id", "name")
);

-- 4. Sectores / Barrios / Localidades
CREATE TABLE IF NOT EXISTS "geo"."sectors" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "municipality_id" UUID NOT NULL REFERENCES "geo"."municipalities"("id") ON DELETE CASCADE,
    "name" VARCHAR(100) NOT NULL,
    "postal_code" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "uq_sectors_municipality_name" UNIQUE ("municipality_id", "name")
);

-- 5. Extensión de inv.warehouses con columnas de ubicación y metadatos
ALTER TABLE "inv"."warehouses" 
    ADD COLUMN IF NOT EXISTS "code" VARCHAR(20) UNIQUE,
    ADD COLUMN IF NOT EXISTS "country_id" UUID REFERENCES "geo"."countries"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "province_id" UUID REFERENCES "geo"."provinces"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "municipality_id" UUID REFERENCES "geo"."municipalities"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "sector_id" UUID REFERENCES "geo"."sectors"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "postal_code" VARCHAR(20),
    ADD COLUMN IF NOT EXISTS "gps_latitude" DECIMAL(10, 7),
    ADD COLUMN IF NOT EXISTS "gps_longitude" DECIMAL(10, 7);

-- 6. Semillas Geográficas Iniciales (República Dominicana)
DO $$
DECLARE
    v_country_id UUID;
    v_prov_dn UUID;
    v_prov_sd UUID;
    v_prov_stg UUID;
    v_prov_altagracia UUID;
    v_mun_dn UUID;
    v_mun_sde UUID;
    v_mun_sdn UUID;
    v_mun_sdo UUID;
    v_mun_stg UUID;
    v_mun_higuey UUID;
    v_sector_id UUID;
BEGIN
    -- País
    INSERT INTO "geo"."countries" ("code", "name", "phone_code", "is_active")
    VALUES ('DOM', 'República Dominicana', '+1', true)
    ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name"
    RETURNING "id" INTO v_country_id;

    -- Provincias
    INSERT INTO "geo"."provinces" ("country_id", "name", "code", "is_active")
    VALUES (v_country_id, 'Distrito Nacional', 'DN', true)
    ON CONFLICT ("country_id", "name") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id" INTO v_prov_dn;

    INSERT INTO "geo"."provinces" ("country_id", "name", "code", "is_active")
    VALUES (v_country_id, 'Santo Domingo', 'SD', true)
    ON CONFLICT ("country_id", "name") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id" INTO v_prov_sd;

    INSERT INTO "geo"."provinces" ("country_id", "name", "code", "is_active")
    VALUES (v_country_id, 'Santiago', 'STG', true)
    ON CONFLICT ("country_id", "name") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id" INTO v_prov_stg;

    INSERT INTO "geo"."provinces" ("country_id", "name", "code", "is_active")
    VALUES (v_country_id, 'La Altagracia', 'AL', true)
    ON CONFLICT ("country_id", "name") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id" INTO v_prov_altagracia;

    -- Municipios Distrito Nacional
    INSERT INTO "geo"."municipalities" ("province_id", "name", "code", "postal_code", "is_active")
    VALUES (v_prov_dn, 'Santo Domingo de Guzmán', '010100', '10100', true)
    ON CONFLICT ("province_id", "name") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id" INTO v_mun_dn;

    -- Municipios Santo Domingo
    INSERT INTO "geo"."municipalities" ("province_id", "name", "code", "postal_code", "is_active")
    VALUES (v_prov_sd, 'Santo Domingo Este', '010200', '11500', true)
    ON CONFLICT ("province_id", "name") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id" INTO v_mun_sde;

    INSERT INTO "geo"."municipalities" ("province_id", "name", "code", "postal_code", "is_active")
    VALUES (v_prov_sd, 'Santo Domingo Norte', '010300', '11200', true)
    ON CONFLICT ("province_id", "name") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id" INTO v_mun_sdn;

    INSERT INTO "geo"."municipalities" ("province_id", "name", "code", "postal_code", "is_active")
    VALUES (v_prov_sd, 'Santo Domingo Oeste', '010400', '10700', true)
    ON CONFLICT ("province_id", "name") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id" INTO v_mun_sdo;

    -- Municipios Santiago
    INSERT INTO "geo"."municipalities" ("province_id", "name", "code", "postal_code", "is_active")
    VALUES (v_prov_stg, 'Santiago de los Caballeros', '020100', '51000', true)
    ON CONFLICT ("province_id", "name") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id" INTO v_mun_stg;

    -- Municipios La Altagracia
    INSERT INTO "geo"."municipalities" ("province_id", "name", "code", "postal_code", "is_active")
    VALUES (v_prov_altagracia, 'Higüey', '030100', '23000', true)
    ON CONFLICT ("province_id", "name") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id" INTO v_mun_higuey;

    -- Sectores en Santo Domingo de Guzmán (DN)
    INSERT INTO "geo"."sectors" ("municipality_id", "name", "postal_code") VALUES
    (v_mun_dn, 'Piantini', '10148'),
    (v_mun_dn, 'Bella Vista', '10112'),
    (v_mun_dn, 'Naco', '10124'),
    (v_mun_dn, 'Gazcue', '10205'),
    (v_mun_dn, 'Evaristo Morales', '10147'),
    (v_mun_dn, 'Los Prados', '10132'),
    (v_mun_dn, 'Zona Colonial', '10210')
    ON CONFLICT ("municipality_id", "name") DO NOTHING;

    -- Sectores en Santo Domingo Este
    INSERT INTO "geo"."sectors" ("municipality_id", "name", "postal_code") VALUES
    (v_mun_sde, 'Alma Rosa I', '11503'),
    (v_mun_sde, 'Ensanche Ozama', '11501'),
    (v_mun_sde, 'Lucerna', '11516'),
    (v_mun_sde, 'Villa Faro', '11511'),
    (v_mun_sde, 'Brisa Oriental', '11520')
    ON CONFLICT ("municipality_id", "name") DO NOTHING;

    -- Sectores en Santiago de los Caballeros
    INSERT INTO "geo"."sectors" ("municipality_id", "name", "postal_code") VALUES
    (v_mun_stg, 'Gurabo', '51052'),
    (v_mun_stg, 'Los Jardines', '51021'),
    (v_mun_stg, 'Cerros de Gurabo', '51051'),
    (v_mun_stg, 'Villa Olga', '51024')
    ON CONFLICT ("municipality_id", "name") DO NOTHING;

    -- Sectores en Higüey / Bávaro / Punta Cana
    INSERT INTO "geo"."sectors" ("municipality_id", "name", "postal_code") VALUES
    (v_mun_higuey, 'Bávaro', '23301'),
    (v_mun_higuey, 'Punta Cana', '23000'),
    (v_mun_higuey, 'Verón', '23302')
    ON CONFLICT ("municipality_id", "name") DO NOTHING;

    -- Actualizar el almacén principal por defecto si no tiene datos geográficos
    SELECT "id" INTO v_sector_id FROM "geo"."sectors" WHERE "municipality_id" = v_mun_dn AND "name" = 'Piantini' LIMIT 1;

    UPDATE "inv"."warehouses"
    SET "code" = COALESCE("code", 'WH-SDQ-01'),
        "country_id" = COALESCE("country_id", v_country_id),
        "province_id" = COALESCE("province_id", v_prov_dn),
        "municipality_id" = COALESCE("municipality_id", v_mun_dn),
        "sector_id" = COALESCE("sector_id", v_sector_id),
        "postal_code" = COALESCE("postal_code", '10148'),
        "address" = COALESCE("address", 'Av. Winston Churchill #1099, Torre Empresarial, Piantini')
    WHERE "name" = 'Almacén Principal' OR "code" IS NULL;

END $$;
