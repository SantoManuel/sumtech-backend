-- ==============================================================================
-- MIGRACIÓN 026: Vencimiento de secuencia NCF en la factura (RI DGII)
-- Persiste el vencimiento de la secuencia de NCF (FechaVencimientoSecuencia)
-- vigente al momento del timbrado, para reimprimir la Representación Impresa
-- con el mismo valor histórico aunque la secuencia se renueve después. No debe
-- confundirse con due_date (fecha de cobro de la factura).
-- Esquema: pos.invoices
-- ==============================================================================

ALTER TABLE "pos"."invoices"
  ADD COLUMN IF NOT EXISTS "ncf_expiry_date" VARCHAR(20);
