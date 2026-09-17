-- 051_create_dgii_certification_runs.sql
-- Historial auditable de cada corrida de certificación e-CF (Set de Pruebas,
-- Simulación Paso 4). Antes, DgiiCertificationService regeneraba los casos en
-- memoria en cada carga de /dashboard/dgii/certificacion y no quedaba ningún
-- rastro de qué e-NCF fue realmente aceptado por la DGII — lo cual además
-- bloqueaba encadenar notas de crédito/débito contra su e-CF base real
-- (ver Fase 5 del plan de certificación DGII).

CREATE TABLE IF NOT EXISTS "public"."dgii_certification_runs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "run_source" VARCHAR(20) NOT NULL,
    "caso_numero" INT,
    "nombre_caso" VARCHAR(255),
    "tipo_ecf" VARCHAR(3) NOT NULL,
    "es_rfce" BOOLEAN NOT NULL DEFAULT FALSE,
    "e_ncf" VARCHAR(13) NOT NULL,
    "e_ncf_modificado" VARCHAR(13),
    "rnc_comprador" VARCHAR(11),
    "razon_social_comprador" VARCHAR(255),
    "monto_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL,
    "track_id" VARCHAR(100),
    "security_code" VARCHAR(20),
    "response_message" TEXT,
    "validation_errors" JSONB,
    "signed_xml" TEXT,
    "environment" VARCHAR(20) NOT NULL,
    "executed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "chk_dgii_certification_runs_source" CHECK (
        "run_source" IN ('TEST_CASE', 'RUN_ALL', 'SIMULATION')
    ),
    CONSTRAINT "chk_dgii_certification_runs_status" CHECK (
        "status" IN ('PENDING', 'ACCEPTED', 'CONTINGENCY', 'REJECTED', 'ERROR')
    )
);

-- Búsqueda del último estado real de un e-NCF (encadenar notas de
-- crédito/débito contra su e-CF base, o consultar el estado de un e-NCF ya
-- procesado): la fila más reciente por e-NCF es la que manda.
CREATE INDEX IF NOT EXISTS "idx_dgii_certification_runs_encf_executed"
    ON "public"."dgii_certification_runs"("e_ncf", "executed_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_dgii_certification_runs_track_id"
    ON "public"."dgii_certification_runs"("track_id");

CREATE INDEX IF NOT EXISTS "idx_dgii_certification_runs_executed_at"
    ON "public"."dgii_certification_runs"("executed_at" DESC);
