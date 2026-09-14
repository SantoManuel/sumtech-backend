-- ==============================================================================
-- MIGRACIÓN 039: Esquema de red (Fase 01 del módulo network)
-- Crea el dominio de red separado del comercial: zonas de cobertura, nodos
-- Mikrotik ("net"."network_nodes" — deliberadamente NO llamado "routers" para
-- no chocar con el uso de esa palabra para el equipo CPE del cliente en la UI
-- de Inventario) y el acceso de red por contrato (Usuario/IP/Estado del
-- sistema WISP anterior). Ninguna tabla del esquema "com" se modifica: el
-- enlace hacia "com"."contracts" se hace desde esta tabla nueva, no al revés.
-- Rollback manual (no hay down-migrations automatizadas en este proyecto):
--   DROP TABLE IF EXISTS "net"."network_access";
--   DROP TABLE IF EXISTS "net"."network_nodes";
--   DROP TABLE IF EXISTS "net"."zones";
--   DROP TYPE IF EXISTS "net"."network_access_provisioning_source_enum";
--   DROP TYPE IF EXISTS "net"."network_access_connection_status_enum";
--   DROP TYPE IF EXISTS "net"."network_nodes_last_sync_status_enum";
--   DROP TYPE IF EXISTS "net"."network_nodes_provisioning_mode_enum";
--   DROP SCHEMA IF EXISTS "net";
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS "net";

-- 1. Zonas de cobertura -----------------------------------------------------
CREATE TABLE IF NOT EXISTS "net"."zones" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(150) NOT NULL UNIQUE,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 2. Nodos de red (Mikrotik/NAS) ---------------------------------------------
DO $$ BEGIN
  CREATE TYPE "net"."network_nodes_provisioning_mode_enum" AS ENUM ('MANUAL', 'ROUTEROS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "net"."network_nodes_last_sync_status_enum" AS ENUM ('NEVER', 'OK', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "net"."network_nodes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(150) NOT NULL UNIQUE,
  "model" VARCHAR(100),
  "management_ip" VARCHAR(45),
  "api_port" INTEGER NOT NULL DEFAULT 8728,
  "zone_id" UUID REFERENCES "net"."zones"("id") ON DELETE SET NULL,
  "provisioning_mode" "net"."network_nodes_provisioning_mode_enum" NOT NULL DEFAULT 'MANUAL',
  "last_sync_at" TIMESTAMP WITH TIME ZONE,
  "last_sync_status" "net"."network_nodes_last_sync_status_enum" NOT NULL DEFAULT 'NEVER',
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_network_nodes_zone_id" ON "net"."network_nodes" ("zone_id");

-- 3. Acceso de red por contrato (Usuario/IP/Estado del sistema anterior) ----
DO $$ BEGIN
  CREATE TYPE "net"."network_access_connection_status_enum" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "net"."network_access_provisioning_source_enum" AS ENUM ('MANUAL', 'ROUTEROS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "net"."network_access" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL UNIQUE REFERENCES "com"."contracts"("id") ON DELETE CASCADE,
  "node_id" UUID REFERENCES "net"."network_nodes"("id") ON DELETE SET NULL,
  "username" VARCHAR(150),
  "service_alias" VARCHAR(50),
  "ip_address" VARCHAR(45),
  "connection_status" "net"."network_access_connection_status_enum" NOT NULL DEFAULT 'PENDING',
  "provisioning_source" "net"."network_access_provisioning_source_enum" NOT NULL DEFAULT 'MANUAL',
  "last_sync_at" TIMESTAMP WITH TIME ZONE,
  "last_sync_error" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_network_access_node_id" ON "net"."network_access" ("node_id");
