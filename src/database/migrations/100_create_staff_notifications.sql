-- ==============================================================================
-- MIGRACIÓN 100: Creación de la tabla de notificaciones para personal (staff)
-- Soporta notificaciones y alertas en tiempo real para administradores,
-- técnicos y cajeros con categorización, niveles de severidad y seguimiento de lectura.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "sec"."staff_notifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID REFERENCES "sec"."users"("id") ON DELETE CASCADE,
  "target_role" VARCHAR(50) DEFAULT 'ALL',
  "category" VARCHAR(50) NOT NULL DEFAULT 'SYSTEM',
  "severity" VARCHAR(20) NOT NULL DEFAULT 'INFO',
  "title" VARCHAR(150) NOT NULL,
  "message" TEXT NOT NULL,
  "link" VARCHAR(255),
  "is_read" BOOLEAN NOT NULL DEFAULT FALSE,
  "read_at" TIMESTAMP WITH TIME ZONE,
  "metadata" JSONB,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_staff_notifications_user_read"
  ON "sec"."staff_notifications" ("user_id", "is_read");

CREATE INDEX IF NOT EXISTS "idx_staff_notifications_role_read"
  ON "sec"."staff_notifications" ("target_role", "is_read");

CREATE INDEX IF NOT EXISTS "idx_staff_notifications_category"
  ON "sec"."staff_notifications" ("category");

CREATE INDEX IF NOT EXISTS "idx_staff_notifications_created_at"
  ON "sec"."staff_notifications" ("created_at" DESC);

COMMENT ON TABLE "sec"."staff_notifications" IS
  'Notificaciones transaccionales y alertas operativas para el personal del WISP (admin, técnicos, cajeros).';
