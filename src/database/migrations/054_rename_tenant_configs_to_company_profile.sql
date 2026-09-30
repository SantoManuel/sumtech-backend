-- ==============================================================================
-- MIGRACIÓN 054: sec.tenant_configs -> sec.company_profile (Fase 4 del plan
-- multi-tenant SaaS).
--
-- "TenantConfigEntity"/"tenant_configs" nació como un picker "multi-empresa"
-- dentro de una sola base de datos (findAll/create/setDefault). Bajo el nuevo
-- modelo de aislamiento por base de datos por tenant (Fases 0-3), ese picker
-- ya no tiene sentido: cada DB de tenant tiene exactamente UNA empresa, la
-- suya. Esta migración:
--   1. Colapsa la tabla a una sola fila (si por lo que sea llegó a tener más
--      de una — prioriza is_default=true, luego la más antigua) antes de
--      soltar esa columna.
--   2. Renombra la tabla y elimina tenant_code/is_default (ya no aplican).
--   3. Agrega las columnas DGII por tenant (antes env vars globales) y
--      site_content (Fase 5/7, sitio público del tenant).
-- ==============================================================================

-- 1. Colapsar a una sola fila (no-op si ya hay 0 o 1 filas).
DELETE FROM "sec"."tenant_configs"
WHERE "id" NOT IN (
  SELECT "id" FROM "sec"."tenant_configs"
  ORDER BY "is_default" DESC, "created_at" ASC
  LIMIT 1
);

-- 2. Renombrar tabla + soltar columnas del picker multi-empresa.
ALTER TABLE "sec"."tenant_configs" RENAME TO "company_profile";

DROP INDEX IF EXISTS "sec"."idx_tenant_configs_code";
DROP INDEX IF EXISTS "sec"."idx_tenant_configs_is_default";

ALTER TABLE "sec"."company_profile" DROP COLUMN IF EXISTS "tenant_code";
ALTER TABLE "sec"."company_profile" DROP COLUMN IF EXISTS "is_default";

-- 3. Columnas nuevas: DGII por tenant + contenido del sitio público.
ALTER TABLE "sec"."company_profile" ADD COLUMN IF NOT EXISTS "dgii_environment" VARCHAR(20);
ALTER TABLE "sec"."company_profile" ADD COLUMN IF NOT EXISTS "dgii_auth_url" TEXT;
ALTER TABLE "sec"."company_profile" ADD COLUMN IF NOT EXISTS "dgii_cert_object_key" TEXT;
ALTER TABLE "sec"."company_profile" ADD COLUMN IF NOT EXISTS "dgii_cert_password" VARCHAR(200);
ALTER TABLE "sec"."company_profile" ADD COLUMN IF NOT EXISTS "site_content" JSONB NOT NULL DEFAULT '{}';
