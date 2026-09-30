-- ==============================================================================
-- PLATFORM MIGRACIÓN 001: Asignaciones globales de túneles VPN por tenant
-- Requisito: RF-MKT-003 Conexión mediante WireGuard
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "platform"."tenant_tunnel_allocations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "platform"."tenants"("id") ON DELETE CASCADE,
  "node_id" UUID NOT NULL,
  "tunnel_type" VARCHAR(30) NOT NULL DEFAULT 'WIREGUARD',
  "assigned_ip" VARCHAR(45) NOT NULL UNIQUE,
  "server_endpoint" VARCHAR(255) NOT NULL,
  "server_public_key" VARCHAR(64) NOT NULL,
  "client_public_key" VARCHAR(64) NOT NULL,
  "client_preshared_key" VARCHAR(64),
  "subnet_cidr" VARCHAR(30) NOT NULL,
  "listen_port" INTEGER NOT NULL DEFAULT 51820,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_tenant_tunnel_alloc_tenant_id" ON "platform"."tenant_tunnel_allocations" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_tenant_tunnel_alloc_node_id" ON "platform"."tenant_tunnel_allocations" ("node_id");
