-- ==============================================================================
-- MIGRACIÓN 030: excluir facturas VOIDED de la unicidad contrato+período
-- El índice uq_invoices_contract_period (migración 020) aplicaba a CUALQUIER
-- factura sin importar su estado, por lo que anular una PENDING_PAYMENT
-- generada por error bloqueaba para siempre que se generara una factura
-- correcta para ese mismo (contrato, período). Se recrea excluyendo VOIDED.
-- Esquema: pos.invoices
-- ==============================================================================

DROP INDEX IF EXISTS "pos"."uq_invoices_contract_period";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_invoices_contract_period"
  ON "pos"."invoices" ("contract_id", "billing_period_start")
  WHERE "contract_id" IS NOT NULL AND "status" <> 'VOIDED';
