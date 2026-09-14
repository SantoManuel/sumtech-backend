-- ==============================================================================
-- MIGRACIÓN 037: Tipo MIME del Comprobante de Depósito
-- Para que el panel de staff pueda previsualizar el comprobante en un modal
-- (imagen inline o PDF embebido) sin forzar la descarga, necesita saber de
-- antemano si es imagen o PDF. Se guarda el mimetype validado al momento de
-- la subida (ya lo teníamos en memoria en el multipart) en vez de tener que
-- volver a consultarlo a MinIO en cada lectura.
-- Esquema: pos.deposit_proofs
-- ==============================================================================

ALTER TABLE "pos"."deposit_proofs"
  ADD COLUMN IF NOT EXISTS "receipt_mime_type" VARCHAR(100);
