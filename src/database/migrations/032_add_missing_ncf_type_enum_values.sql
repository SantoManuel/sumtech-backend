-- ==============================================================================
-- MIGRACIÓN 032: valores faltantes en pos.invoices_ncf_type_enum
-- InvoiceEntity.ncfType siempre declaró 8 tipos ('E31','E32','E33','E34','E44',
-- 'E45','B01','B02') pero el enum real en la BD solo tenía 4 (B01, B02, E31,
-- E32) — drift de esquema pre-existente, nunca antes ejercitado porque ningún
-- flujo había intentado emitir E33/E34/E44/E45 hasta InvoicingService.createCreditNote.
-- Mismo patrón de bug ya documentado para otros enums de este proyecto
-- (ver migración 023, sale_details.item_type).
-- Esquema: pos.invoices
-- ==============================================================================

DO $$ BEGIN
  ALTER TYPE "pos"."invoices_ncf_type_enum" ADD VALUE IF NOT EXISTS 'E33';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "pos"."invoices_ncf_type_enum" ADD VALUE IF NOT EXISTS 'E34';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "pos"."invoices_ncf_type_enum" ADD VALUE IF NOT EXISTS 'E44';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "pos"."invoices_ncf_type_enum" ADD VALUE IF NOT EXISTS 'E45';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
