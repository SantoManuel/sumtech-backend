-- ==============================================================================
-- MIGRACIÓN: Agregar columnas de programación y tiempos a tickets
-- Esquema: tickets.tickets
-- ==============================================================================

ALTER TABLE "tickets"."tickets" 
  ADD COLUMN IF NOT EXISTS "scheduled_start" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "estimated_duration_minutes" INTEGER DEFAULT 60;

ALTER TABLE "com"."plans" 
  ALTER COLUMN "itbis_rate" SET DEFAULT 0.18;
