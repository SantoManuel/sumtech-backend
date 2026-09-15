-- ==============================================================================
-- MIGRACIÓN 042: Firma electrónica de contratos (cliente y empresa)
-- Registro INMUTABLE (insert-only, nunca UPDATE/DELETE desde la app) de cada
-- firma capturada — ya sea en oficina (staff) o en calle (técnico durante la
-- instalación). Un contrato puede tener varias filas para la misma "party"
-- a lo largo del tiempo (si hace falta corregir/refirmar); la vigente es
-- siempre la de "signed_at" más reciente por (contract_id, party) — ver
-- ContractSignaturesService.getLatestByParty(). No se agrega UNIQUE sobre
-- (contract_id, party) a propósito: bloquearía la refirma.
-- Esquema: com.contract_signatures
-- Rollback manual:
--   DROP TABLE IF EXISTS "com"."contract_signatures";
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "com"."contract_signatures" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL REFERENCES "com"."contracts"("id") ON DELETE CASCADE,
  "party" VARCHAR(10) NOT NULL CHECK ("party" IN ('CLIENT', 'COMPANY')),
  "signature_file_key" VARCHAR(500) NOT NULL,
  "signed_by_name" VARCHAR(150) NOT NULL,
  "method" VARCHAR(10) NOT NULL CHECK ("method" IN ('DRAW', 'TYPE', 'UPLOAD')),
  "signed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "ip_address" VARCHAR(45),
  "captured_by_user_id" UUID NOT NULL REFERENCES "sec"."users"("id"),
  "captured_by_role" VARCHAR(10) NOT NULL CHECK ("captured_by_role" IN ('STAFF', 'TECNICO')),
  "gps_latitude" NUMERIC(10, 7),
  "gps_longitude" NUMERIC(10, 7),
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Cubre tanto "¿ya hay firmas de este contrato?" como la búsqueda de la
-- vigente por party (ORDER BY signed_at DESC LIMIT 1).
CREATE INDEX IF NOT EXISTS "idx_contract_signatures_contract_party_signed_at"
  ON "com"."contract_signatures" ("contract_id", "party", "signed_at" DESC);
