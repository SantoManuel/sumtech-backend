-- ==============================================================================
-- MIGRACIÓN 005: Corrige columnas faltantes en pos.invoices (deuda técnica
-- preexistente, misma causa que 004: InvoiceEntity se extendió sin migración).
-- Esquema: pos.invoices
-- ==============================================================================

ALTER TABLE "pos"."invoices"
  ADD COLUMN IF NOT EXISTS "signed_xml_content" TEXT,
  ADD COLUMN IF NOT EXISTS "contingency_mode" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "buyer_doc_type" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "buyer_doc_number" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "buyer_name" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "tax_summary" JSONB;
