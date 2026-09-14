-- ==============================================================================
-- MIGRACIÓN 031: soporte de Nota de Crédito (E34) sobre facturas ISSUED
-- InvoicingService.createCreditNote crea una nueva fila (ncfType E34) que
-- referencia la factura ISSUED original — antes no existía ninguna columna
-- que vinculara una factura con otra.
-- Esquema: pos.invoices
-- ==============================================================================

ALTER TABLE "pos"."invoices"
  ADD COLUMN IF NOT EXISTS "original_invoice_id" uuid NULL REFERENCES "pos"."invoices"("id"),
  ADD COLUMN IF NOT EXISTS "ncf_modificado" varchar(20) NULL,
  ADD COLUMN IF NOT EXISTS "codigo_modificacion" varchar(1) NULL,
  ADD COLUMN IF NOT EXISTS "razon_modificacion" varchar(90) NULL;

-- A lo sumo una Nota de Crédito por factura original (defensa en profundidad,
-- además del chequeo explícito en InvoicingService.createCreditNote).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoices_original_invoice"
  ON "pos"."invoices" ("original_invoice_id")
  WHERE "original_invoice_id" IS NOT NULL;
