-- ==============================================================================
-- MIGRACIÓN 016: Categorías de Activos Fijos, Herramientas, Mobiliario y Flotilla
-- ==============================================================================

DO $$ BEGIN
  ALTER TYPE "inv"."categories_article_type_enum" ADD VALUE IF NOT EXISTS 'FIXED_ASSET';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
