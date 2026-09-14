-- ==============================================================================
-- MIGRACIÓN 025: Arranca "pos"."ecf_sequences" en un punto seguro
-- Como "pos"."ecf_sequences" nunca existió (ver migración 024), cualquier NCF ya
-- usado por facturas sembradas/emitidas antes de esta migración no estaba
-- reflejado en ningún contador. Sin este seed, InvoicingService.getNextNcfSequence
-- reasignaría NCF ya existentes (ej. E3200000001) y violaría la unicidad de
-- "pos"."invoices"."ncf_number". Arranca cada tipo en (máximo NCF ya usado + 1).
-- ==============================================================================

INSERT INTO "pos"."ecf_sequences" ("ncf_type", "current_sequence")
SELECT
  "ncf_type"::text::"pos"."ecf_sequences_ncf_type_enum",
  MAX(RIGHT("ncf_number", 8)::bigint) + 1
FROM "pos"."invoices"
WHERE "ncf_type" IS NOT NULL AND "ncf_number" IS NOT NULL
GROUP BY "ncf_type"
ON CONFLICT ("ncf_type") DO UPDATE
  SET "current_sequence" = GREATEST("pos"."ecf_sequences"."current_sequence", EXCLUDED."current_sequence");
