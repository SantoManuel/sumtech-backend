-- ==============================================================================
-- MIGRACIÓN 070: Ventana de tiempo para anulación de facturas por cajero (POS)
-- Agrega la columna cashier_void_window_hours a com.billing_settings para
-- controlar el tiempo máximo (en horas) en el que un cajero puede anular o
-- emitir nota de crédito antes de requerir autorización de supervisor.
-- ==============================================================================

ALTER TABLE "com"."billing_settings"
  ADD COLUMN IF NOT EXISTS "cashier_void_window_hours" INT NOT NULL DEFAULT 48;
