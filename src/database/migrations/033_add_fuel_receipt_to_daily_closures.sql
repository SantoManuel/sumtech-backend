-- ==============================================================================
-- MIGRACIÓN 033: Foto de Factura de Combustible en Cierre de Jornada
-- El combustible se guardaba como un monto suelto sin comprobante, a diferencia
-- de cada gasto de tickets.daily_closure_expenses (que sí exige foto). Se agrega
-- la misma exigencia de evidencia fotográfica al combustible.
-- Esquema: tickets.daily_closures
-- ==============================================================================

ALTER TABLE "tickets"."daily_closures"
  ADD COLUMN IF NOT EXISTS "fuel_receipt_photo_key" VARCHAR(500);
