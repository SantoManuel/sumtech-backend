-- 049_create_client_import_batches.sql
-- Importación masiva de clientes desde el formato legacy (Excel/CSV del
-- sistema WISP anterior). Complementa el ETL de red ya existente
-- (src/database/scripts/legacy-network-import, Fase 04 del plan de
-- integración): esta tabla trackea el import de clientes/contratos/planes,
-- que debe correr ANTES de ese script (busca clientes por docNumber).

CREATE TABLE IF NOT EXISTS "com"."client_import_batches" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ANALYZED',
    "format" VARCHAR(10) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "minio_object_key" VARCHAR(255) NOT NULL,
    "total_rows" INT NOT NULL DEFAULT 0,
    "processed_rows" INT NOT NULL DEFAULT 0,
    "created_count" INT NOT NULL DEFAULT 0,
    "updated_count" INT NOT NULL DEFAULT 0,
    "error_count" INT NOT NULL DEFAULT 0,
    -- Mapeo Zona/Barrio legacy -> Sector real, resuelto a mano por el admin
    -- antes de poder confirmar (decisión de negocio: obligatorio, nunca se
    -- infiere). Forma: { "<barrio>||<ciudadMunicipio>": { "sectorId": "..." } }
    "location_mapping" JSONB NOT NULL DEFAULT '{}',
    "uploaded_by" UUID REFERENCES "sec"."users"("id") ON DELETE SET NULL,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "completed_at" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "chk_client_import_batches_status" CHECK (
        "status" IN ('ANALYZED', 'MAPPED', 'QUEUED', 'PROCESSING', 'DONE', 'FAILED')
    ),
    CONSTRAINT "chk_client_import_batches_format" CHECK ("format" IN ('csv', 'excel'))
);

CREATE INDEX IF NOT EXISTS "idx_client_import_batches_created_at"
    ON "com"."client_import_batches"("created_at" DESC);

CREATE TABLE IF NOT EXISTS "com"."client_import_row_errors" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL REFERENCES "com"."client_import_batches"("id") ON DELETE CASCADE,
    "row_number" INT NOT NULL,
    "raw_data" JSONB,
    "error_message" TEXT NOT NULL,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_client_import_row_errors_batch"
    ON "com"."client_import_row_errors"("batch_id", "row_number");
