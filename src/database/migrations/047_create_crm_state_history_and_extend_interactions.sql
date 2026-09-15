-- 047_create_crm_state_history_and_extend_interactions.sql
-- Fase 2 del CRM de producción: historial de cambios de estado (auditoría) y
-- actividades que ahora pueden colgar de una Opportunity todavía sin cliente
-- (antes crm.interactions solo admitía client_id, lo que impedía registrar
-- seguimiento sobre un prospecto que aún no se ha convertido).

CREATE TABLE IF NOT EXISTS "crm"."opportunity_state_history" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL REFERENCES "crm"."opportunities"("id") ON DELETE CASCADE,
    "previous_status_id" UUID REFERENCES "crm"."subscription_statuses"("id"),
    "new_status_id" UUID NOT NULL REFERENCES "crm"."subscription_statuses"("id"),
    "changed_by_user_id" UUID REFERENCES "sec"."users"("id") ON DELETE SET NULL,
    "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_opportunity_state_history_opportunity" ON "crm"."opportunity_state_history"("opportunity_id");
CREATE INDEX IF NOT EXISTS "idx_opportunity_state_history_changed_at" ON "crm"."opportunity_state_history"("changed_at");

ALTER TABLE "crm"."interactions"
    ADD COLUMN IF NOT EXISTS "opportunity_id" UUID REFERENCES "crm"."opportunities"("id") ON DELETE CASCADE;

ALTER TABLE "crm"."interactions"
    ALTER COLUMN "client_id" DROP NOT NULL;

-- Una interacción debe pertenecer a un cliente ya formal o a una oportunidad
-- todavía en el embudo (o ambas, tras el cierre) — nunca a ninguna de las dos.
ALTER TABLE "crm"."interactions"
    DROP CONSTRAINT IF EXISTS "chk_interactions_client_or_opportunity";
ALTER TABLE "crm"."interactions"
    ADD CONSTRAINT "chk_interactions_client_or_opportunity"
    CHECK ("client_id" IS NOT NULL OR "opportunity_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "idx_interactions_opportunity" ON "crm"."interactions"("opportunity_id");
