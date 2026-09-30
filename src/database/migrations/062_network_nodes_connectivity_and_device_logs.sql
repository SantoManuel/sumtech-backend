-- ==============================================================================
-- MIGRACIÓN 062: Conectividad MikroTik extendida y log de eventos de dispositivos
-- Requisitos: RF-MKT-001 a RF-MKT-010 (Nivel 1 Conectividad y Registro de Equipos)
-- ==============================================================================

-- 1. Métodos de conexión y estados de nodo
DO $$ BEGIN
  CREATE TYPE "net"."network_nodes_connection_method_enum" AS ENUM (
    'wireguard',
    'ddns',
    'public_ip',
    'api',
    'ssh'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "net"."network_nodes_status_enum" AS ENUM (
    'ACTIVE',
    'UNREACHABLE',
    'ERROR_AUTH',
    'MAINTENANCE',
    'PROVISIONING'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Columnas aditivas para "net"."network_nodes"
ALTER TABLE "net"."network_nodes"
  ADD COLUMN IF NOT EXISTS "connection_method" "net"."network_nodes_connection_method_enum" NOT NULL DEFAULT 'wireguard',
  ADD COLUMN IF NOT EXISTS "status" "net"."network_nodes_status_enum" NOT NULL DEFAULT 'PROVISIONING',
  ADD COLUMN IF NOT EXISTS "transport_type" VARCHAR(30) NOT NULL DEFAULT 'REST',
  ADD COLUMN IF NOT EXISTS "ddns_hostname" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "wireguard_public_key" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "wireguard_listen_port" INTEGER NOT NULL DEFAULT 51820,
  ADD COLUMN IF NOT EXISTS "wireguard_ip" VARCHAR(45),
  ADD COLUMN IF NOT EXISTS "api_user" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "api_password_enc" TEXT,
  ADD COLUMN IF NOT EXISTS "ssh_port" INTEGER NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS "routeros_version" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "last_heartbeat_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "cpu_usage" NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS "memory_free_bytes" BIGINT,
  ADD COLUMN IF NOT EXISTS "memory_total_bytes" BIGINT,
  ADD COLUMN IF NOT EXISTS "disk_free_bytes" BIGINT,
  ADD COLUMN IF NOT EXISTS "disk_total_bytes" BIGINT,
  ADD COLUMN IF NOT EXISTS "uptime_seconds" BIGINT,
  ADD COLUMN IF NOT EXISTS "temperature_celsius" NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS "voltage" NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "last_error_code" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "last_error_message" TEXT;

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS "idx_network_nodes_status" ON "net"."network_nodes" ("status");
CREATE INDEX IF NOT EXISTS "idx_network_nodes_conn_method" ON "net"."network_nodes" ("connection_method");
CREATE INDEX IF NOT EXISTS "idx_network_nodes_deleted_at" ON "net"."network_nodes" ("deleted_at");

-- 3. Tabla de Logs de Eventos y Operaciones de Dispositivos (RF-MKT-010)
CREATE TABLE IF NOT EXISTS "net"."device_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" UUID REFERENCES "net"."network_nodes"("id") ON DELETE CASCADE,
  "event_type" VARCHAR(50) NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "error_code" VARCHAR(50),
  "message" TEXT NOT NULL,
  "raw_details" JSONB,
  "ip_address" VARCHAR(45),
  "actor_user_id" UUID,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_device_logs_node_id" ON "net"."device_logs" ("node_id");
CREATE INDEX IF NOT EXISTS "idx_device_logs_event_type" ON "net"."device_logs" ("event_type");
CREATE INDEX IF NOT EXISTS "idx_device_logs_created_at" ON "net"."device_logs" ("created_at" DESC);
