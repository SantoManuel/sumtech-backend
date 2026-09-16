-- 046_create_crm_opportunity_model.sql
-- Fase 1 del CRM de producción: catálogos editables (estado de suscripción,
-- próxima acción, motivo de pérdida) + migración de crm.leads a
-- crm.opportunities (pipeline real con cliente/contrato al cierre, round
-- robin de responsable, próxima acción con fecha, valor potencial).

-- 1. Catálogos ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "crm"."subscription_statuses" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- "code" es el identificador inmutable que usa la lógica de negocio
    -- (PROSPECTO/EN_NEGOCIACION/SUSCRIPCION_ACTIVA/PERDIDA); "name" es la
    -- etiqueta editable desde la UI de administración.
    "code" VARCHAR(30) NOT NULL UNIQUE,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "sort_order" INT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "crm"."next_actions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL UNIQUE,
    "name" VARCHAR(150) NOT NULL,
    -- Códigos de crm.subscription_statuses para los que esta acción es
    -- sugerida (tabla 1.2 de la especificación) — texto plano en vez de FK
    -- many-to-many para no sobre-diseñar algo que solo alimenta una sugerencia
    -- de UI, no una regla de negocio dura.
    "suggested_status_codes" TEXT[] NOT NULL DEFAULT '{}',
    "sort_order" INT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "crm"."loss_reasons" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL UNIQUE,
    "sort_order" INT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO "crm"."subscription_statuses" ("code", "name", "sort_order") VALUES
    ('PROSPECTO', 'Prospecto', 1),
    ('EN_NEGOCIACION', 'En Negociación', 2),
    ('SUSCRIPCION_ACTIVA', 'Suscripción Activa', 3),
    ('PERDIDA', 'Pérdida', 4)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "crm"."next_actions" ("code", "name", "suggested_status_codes", "sort_order") VALUES
    ('LLAMAR_PRESENTACION', 'Llamar para presentación', ARRAY['PROSPECTO'], 1),
    ('ENVIAR_PROPUESTA', 'Enviar propuesta', ARRAY['PROSPECTO', 'EN_NEGOCIACION'], 2),
    ('REUNION_CIERRE', 'Reunión de cierre', ARRAY['EN_NEGOCIACION'], 3),
    ('LLAMAR_SEGUIMIENTO', 'Llamar para seguimiento', ARRAY['PROSPECTO', 'EN_NEGOCIACION', 'PERDIDA'], 4),
    ('ENVIAR_ENCUESTA', 'Enviar encuesta de satisfacción', ARRAY['SUSCRIPCION_ACTIVA'], 5)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "crm"."loss_reasons" ("name", "sort_order") VALUES
    ('Precio', 1),
    ('Cobertura no disponible', 2),
    ('Eligió otro proveedor', 3),
    ('Sin respuesta', 4),
    ('Otro', 5)
ON CONFLICT ("name") DO NOTHING;

-- 2. crm.leads -> crm.opportunities ------------------------------------------

ALTER TABLE "crm"."leads" RENAME TO "opportunities";

ALTER TABLE "crm"."opportunities"
    ADD COLUMN IF NOT EXISTS "client_id" UUID REFERENCES "com"."clients"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "subscription_status_id" UUID REFERENCES "crm"."subscription_statuses"("id"),
    ADD COLUMN IF NOT EXISTS "next_action_id" UUID REFERENCES "crm"."next_actions"("id"),
    ADD COLUMN IF NOT EXISTS "next_action_date" DATE,
    ADD COLUMN IF NOT EXISTS "potential_value" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "assigned_user_id" UUID REFERENCES "sec"."users"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "service_interest" VARCHAR(20),
    ADD COLUMN IF NOT EXISTS "installation_address" TEXT,
    ADD COLUMN IF NOT EXISTS "loss_reason_id" UUID REFERENCES "crm"."loss_reasons"("id"),
    ADD COLUMN IF NOT EXISTS "first_contact_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS "last_updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- Backfill: mapea el status viejo (enum) al nuevo catálogo por código.
UPDATE "crm"."opportunities" o
SET "subscription_status_id" = s."id"
FROM "crm"."subscription_statuses" s
WHERE o."subscription_status_id" IS NULL
    AND s."code" = CASE o."status"
        WHEN 'NEW' THEN 'PROSPECTO'
        WHEN 'CONTACTED' THEN 'EN_NEGOCIACION'
        WHEN 'QUALIFIED' THEN 'EN_NEGOCIACION'
        WHEN 'CONVERTED' THEN 'SUSCRIPCION_ACTIVA'
        WHEN 'DISCARDED' THEN 'PERDIDA'
    END;

-- Los DISCARDED migrados quedan con un motivo de pérdida genérico (no había
-- captura de motivo en el modelo viejo).
UPDATE "crm"."opportunities" o
SET "loss_reason_id" = (SELECT "id" FROM "crm"."loss_reasons" WHERE "name" = 'Otro' LIMIT 1)
WHERE o."status" = 'DISCARDED' AND o."loss_reason_id" IS NULL;

-- NOTA: los leads ya CONVERTED no se pueden enlazar retroactivamente a su
-- Client real — ese vínculo nunca existió en el modelo viejo. client_id queda
-- NULL para esos registros históricos.

ALTER TABLE "crm"."opportunities" ALTER COLUMN "subscription_status_id" SET NOT NULL;

ALTER TABLE "crm"."opportunities" DROP COLUMN IF EXISTS "status";
DROP TYPE IF EXISTS "crm"."leads_status_enum";

CREATE INDEX IF NOT EXISTS "idx_opportunities_subscription_status" ON "crm"."opportunities"("subscription_status_id");
CREATE INDEX IF NOT EXISTS "idx_opportunities_assigned_user" ON "crm"."opportunities"("assigned_user_id");
CREATE INDEX IF NOT EXISTS "idx_opportunities_client" ON "crm"."opportunities"("client_id");
CREATE INDEX IF NOT EXISTS "idx_opportunities_next_action_date" ON "crm"."opportunities"("next_action_date");

-- 3. Cursor de asignación round robin (una sola fila, patrón singleton) -----

CREATE TABLE IF NOT EXISTS "crm"."round_robin_cursor" (
    "id" SMALLINT PRIMARY KEY DEFAULT 1,
    "last_assigned_user_id" UUID REFERENCES "sec"."users"("id") ON DELETE SET NULL,
    CONSTRAINT "chk_round_robin_cursor_singleton" CHECK ("id" = 1)
);

INSERT INTO "crm"."round_robin_cursor" ("id", "last_assigned_user_id")
VALUES (1, NULL)
ON CONFLICT ("id") DO NOTHING;
