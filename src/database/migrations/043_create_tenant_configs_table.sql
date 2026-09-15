-- 043_create_tenant_configs_table.sql
-- Creación de la tabla de configuración corporativa con soporte Multi-Tenant nativo
-- e integración con el módulo de geografía normalizado (geo.countries, geo.provinces, geo.municipalities, geo.sectors)

CREATE SCHEMA IF NOT EXISTS "sec";

CREATE TABLE IF NOT EXISTS "sec"."tenant_configs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_code" VARCHAR(50) NOT NULL UNIQUE,
    "name" VARCHAR(200) NOT NULL,
    "company_name" VARCHAR(200) NOT NULL,
    "commercial_name" VARCHAR(200),
    "rnc" VARCHAR(20) NOT NULL,
    "address" TEXT,
    "country_id" UUID REFERENCES "geo"."countries"("id") ON DELETE SET NULL,
    "province_id" UUID REFERENCES "geo"."provinces"("id") ON DELETE SET NULL,
    "municipality_id" UUID REFERENCES "geo"."municipalities"("id") ON DELETE SET NULL,
    "sector_id" UUID REFERENCES "geo"."sectors"("id") ON DELETE SET NULL,
    "phone" VARCHAR(50),
    "email" VARCHAR(150),
    "support_email" VARCHAR(150),
    "website" VARCHAR(200),
    "logo_url" TEXT,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'DOP',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'America/Santo_Domingo',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_tenant_configs_code" ON "sec"."tenant_configs"("tenant_code");
CREATE INDEX IF NOT EXISTS "idx_tenant_configs_is_default" ON "sec"."tenant_configs"("is_default");

-- Insertar tenant principal (Sumtech) enlazado a la geografía existente de la República Dominicana
DO $$
DECLARE
    v_country_id UUID;
    v_prov_dn UUID;
    v_mun_dn UUID;
    v_sector_id UUID;
BEGIN
    SELECT id INTO v_country_id FROM "geo"."countries" WHERE code = 'DOM' LIMIT 1;
    SELECT id INTO v_prov_dn FROM "geo"."provinces" WHERE (country_id = v_country_id AND (code = 'DN' OR name ILIKE '%Distrito Nacional%')) LIMIT 1;
    SELECT id INTO v_mun_dn FROM "geo"."municipalities" WHERE (province_id = v_prov_dn AND (code = '010100' OR name ILIKE '%Santo Domingo de Guzmán%')) LIMIT 1;
    SELECT id INTO v_sector_id FROM "geo"."sectors" WHERE (municipality_id = v_mun_dn AND name ILIKE '%Piantini%') LIMIT 1;

    INSERT INTO "sec"."tenant_configs" (
        "tenant_code",
        "name",
        "company_name",
        "commercial_name",
        "rnc",
        "address",
        "country_id",
        "province_id",
        "municipality_id",
        "sector_id",
        "phone",
        "email",
        "support_email",
        "website",
        "currency",
        "timezone",
        "is_active",
        "is_default"
    ) VALUES (
        'DEFAULT',
        'Sumtech Telecom',
        'SUMTECH TELECOM S.R.L.',
        'SUMTECH FIBRA & TV',
        '131000000',
        'Av. 27 de Febrero esq. Winston Churchill, Santo Domingo, D.N.',
        v_country_id,
        v_prov_dn,
        v_mun_dn,
        v_sector_id,
        '809-555-0199',
        'facturacion@sumtech.com.do',
        'soporte@sumtech.com.do',
        'https://sumtech.com.do',
        'DOP',
        'America/Santo_Domingo',
        true,
        true
    )
    ON CONFLICT ("tenant_code") DO NOTHING;
END $$;
