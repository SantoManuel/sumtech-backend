-- ==============================================================================
-- MIGRACIÓN 081: columnas faltantes del commit c2b8970 (certificación DGII e-CF)
-- ==============================================================================
-- El commit c2b8970 agregó estas columnas a sus entidades pero nunca creó la
-- migración correspondiente, causando "column ... does not exist" en
-- producción (InvoicingService.findAll y PosService.getActiveRegister, ambos
-- al cargar/seleccionar InvoiceEntity con su campo dgiiResponse).
-- ==============================================================================

ALTER TABLE "pos"."invoices"
  ADD COLUMN IF NOT EXISTS "dgii_response" JSONB NULL;

ALTER TABLE "public"."dgii_certification_runs"
  ADD COLUMN IF NOT EXISTS "raw_response" JSONB NULL;
