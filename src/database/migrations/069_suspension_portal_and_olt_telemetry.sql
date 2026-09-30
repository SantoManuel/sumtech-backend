-- ==============================================================================
-- MIGRACIÓN 069: Portal de suspensión cautivo y telemetría de métricas OLT (Fase 9)
-- RF-PORTAL-001, RF-PORTAL-002, RF-PORTAL-003, RF-OLT-005
-- ==============================================================================

-- 1. Soporte de portal de aviso y modo de suspensión en nodos de red
ALTER TABLE "net"."network_nodes"
  ADD COLUMN IF NOT EXISTS "suspension_mode" VARCHAR(30) NOT NULL DEFAULT 'DISABLED',
  ADD COLUMN IF NOT EXISTS "portal_installed" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "portal_installed_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "portal_rules_status" VARCHAR(30) NOT NULL DEFAULT 'NOT_INSTALLED',
  ADD COLUMN IF NOT EXISTS "portal_ip" VARCHAR(45) NULL,
  ADD COLUMN IF NOT EXISTS "portal_port" INTEGER NOT NULL DEFAULT 80;

-- 2. Personalización de Portal de Suspensión y soporte de Telegram en Perfil de Empresa
ALTER TABLE "sec"."company_profile"
  ADD COLUMN IF NOT EXISTS "whatsapp" VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS "suspension_portal" JSONB NOT NULL DEFAULT '{
    "title": "Aviso de Suspensión de Servicio",
    "message": "Estimado cliente, su servicio de Internet presenta facturas pendientes de pago. Por favor regularice su situación para reactivar el servicio de manera automática.",
    "primaryColor": "#0891b2",
    "accentColor": "#f59e0b",
    "paymentMethods": ["Transferencia Bancaria", "Pago en Efectivo", "Punto de Venta POS", "Tarjeta de Crédito"],
    "bankAccounts": [],
    "supportPhone": "",
    "supportWhatsapp": "",
    "enableChatbot": true
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS "telegram_bot_token" VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS "telegram_chat_id" VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS "telegram_alerts_enabled" BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Tabla de series temporales de métricas y telemetría OLT (RF-OLT-005)
CREATE TABLE IF NOT EXISTS "net"."olt_metrics" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "olt_id" UUID NOT NULL REFERENCES "net"."olts"("id") ON DELETE CASCADE,
  "cpu_usage_percent" NUMERIC(5,2) NULL,
  "memory_usage_percent" NUMERIC(5,2) NULL,
  "temperature_celsius" NUMERIC(5,2) NULL,
  "uptime_seconds" BIGINT NULL,
  "active_onus_count" INTEGER NOT NULL DEFAULT 0,
  "offline_onus_count" INTEGER NOT NULL DEFAULT 0,
  "alarms_count" INTEGER NOT NULL DEFAULT 0,
  "cards_info" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "alarms_info" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "raw_telemetry" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_olt_metrics_olt_id_created_at" 
  ON "net"."olt_metrics"("olt_id", "created_at" DESC);
