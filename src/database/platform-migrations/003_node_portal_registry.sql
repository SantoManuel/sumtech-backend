-- ==============================================================================
-- PLATFORM MIGRACIÓN 003: Registro central de IP pública de router -> tenant
-- (portal cautivo multi-tenant, RF-PORTAL-001/004)
-- ==============================================================================
--
-- POR QUÉ: el redirector público /platform/portal-redirect identifica el
-- tenant de un cliente suspendido SOLO por la IP de origen del router (ver
-- comentario en NodePortalRegistryEntity) -- esa búsqueda tiene que ser
-- cross-tenant (no sabemos a qué base de datos de tenant consultar hasta
-- resolver justo este dato), así que vive en la DB de plataforma, no en la
-- de cada tenant.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "platform"."node_portal_registry" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "platform"."tenants"("id") ON DELETE CASCADE,
  "node_id" UUID NOT NULL,
  "public_ip" VARCHAR(45) NOT NULL UNIQUE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_node_portal_registry_tenant_id" ON "platform"."node_portal_registry" ("tenant_id");
