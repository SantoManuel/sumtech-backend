-- 048_create_crm_sla_and_satisfaction_surveys.sql
-- Fase 3 del CRM de producción: SLA comercial (máximo de días sin actividad
-- por estado antes de alertar) y encuesta de satisfacción real por enlace
-- (mismo patrón de token de un solo uso que ya usa com.address_gps_requests).

CREATE TABLE IF NOT EXISTS "crm"."sla_policies" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "subscription_status_id" UUID NOT NULL UNIQUE REFERENCES "crm"."subscription_statuses"("id") ON DELETE CASCADE,
    "max_days_without_activity" INT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Seed: solo los estados activos del embudo tienen SLA (los terminales
-- SUSCRIPCION_ACTIVA/PERDIDA no aplican — ya no requieren seguimiento).
INSERT INTO "crm"."sla_policies" ("subscription_status_id", "max_days_without_activity")
SELECT "id", 3 FROM "crm"."subscription_statuses" WHERE "code" = 'PROSPECTO'
ON CONFLICT ("subscription_status_id") DO NOTHING;

INSERT INTO "crm"."sla_policies" ("subscription_status_id", "max_days_without_activity")
SELECT "id", 7 FROM "crm"."subscription_statuses" WHERE "code" = 'EN_NEGOCIACION'
ON CONFLICT ("subscription_status_id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "crm"."satisfaction_surveys" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL REFERENCES "crm"."opportunities"("id") ON DELETE CASCADE,
    "token" VARCHAR(64) NOT NULL UNIQUE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "rating" SMALLINT,
    "comment" TEXT,
    "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "submitted_at" TIMESTAMP WITH TIME ZONE,
    "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT "chk_satisfaction_surveys_status" CHECK ("status" IN ('PENDING', 'SUBMITTED', 'EXPIRED')),
    CONSTRAINT "chk_satisfaction_surveys_rating" CHECK ("rating" IS NULL OR ("rating" BETWEEN 1 AND 5))
);

CREATE INDEX IF NOT EXISTS "idx_satisfaction_surveys_opportunity" ON "crm"."satisfaction_surveys"("opportunity_id");
