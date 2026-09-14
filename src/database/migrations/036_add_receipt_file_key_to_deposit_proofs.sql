-- ==============================================================================
-- MIGRACIÓN 036: Comprobante de Depósito como Archivo Real (MinIO)
-- El cliente enviaba el comprobante como un link de texto libre (receipt_url),
-- opcional, sin ninguna validación — permitía "validar" un pago sin evidencia
-- real. Se agrega receipt_file_key para guardar el object key de MinIO del
-- archivo subido (imagen o PDF). receipt_url se conserva nullable únicamente
-- para no perder los registros históricos ya guardados con ese campo; los
-- envíos nuevos ya no lo usan.
-- Esquema: pos.deposit_proofs
-- ==============================================================================

ALTER TABLE "pos"."deposit_proofs"
  ADD COLUMN IF NOT EXISTS "receipt_file_key" VARCHAR(500);
