-- ==============================================================================
-- MIGRACIÓN 024: Corrige deuda técnica preexistente (no introducida por la Fase
-- 4): la tabla "pos"."ecf_sequences" — núcleo de la reserva atómica del
-- correlativo NCF (InvoicingService.getNextNcfSequence) — nunca fue creada por
-- ninguna migración, pese a que EcfSequenceEntity ya está registrada y en uso.
-- Esto significa que el flujo real de timbrado (emitInvoice/settleInvoice)
-- nunca pudo ejecutarse contra esta base de datos; las 7 facturas ya existentes
-- fueron sembradas directamente (initial-seed.ts) sin pasar por este mecanismo.
-- ==============================================================================

DO $$ BEGIN
  CREATE TYPE "pos"."ecf_sequences_ncf_type_enum" AS ENUM ('E31', 'E32', 'E33', 'E34', 'E44', 'E45', 'B01', 'B02');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "pos"."ecf_sequences" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ncf_type" "pos"."ecf_sequences_ncf_type_enum" NOT NULL UNIQUE,
  "serie" VARCHAR(5) NOT NULL DEFAULT 'E',
  "current_sequence" BIGINT NOT NULL DEFAULT 1,
  "start_sequence" BIGINT NOT NULL DEFAULT 1,
  "end_sequence" BIGINT NOT NULL DEFAULT 100000,
  "authorization_number" VARCHAR(50) NOT NULL DEFAULT '6005450276',
  "expiry_date" VARCHAR(20) NOT NULL DEFAULT '31-12-2026',
  "alert_remaining" INT NOT NULL DEFAULT 50,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
