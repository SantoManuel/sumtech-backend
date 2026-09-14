-- ==============================================================================
-- MIGRACIÓN 023: Corrige deuda técnica preexistente (drift de esquema, no
-- introducida por la Fase 4): "pos"."sale_details".item_type nunca tuvo el valor
-- 'PLAN_SUBSCRIPTION' en la base de datos real, aunque SaleDetailEntity ya lo
-- declara como valor por defecto. Esto bloqueaba silenciosamente cualquier
-- intento de agregar un cargo de tipo "mensualidad" (ej. botón "agregar mensualidad
-- al carrito" del POS) y bloquea también el cobro de facturas recurrentes (Fase 4).
-- ==============================================================================

DO $$ BEGIN
  ALTER TYPE "pos"."sale_details_item_type_enum" ADD VALUE IF NOT EXISTS 'PLAN_SUBSCRIPTION';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
