-- ==============================================================================
-- MIGRACIÓN 028: Apertura de Jornada del Técnico de Campo
-- El "Cierre de Jornada" (migración 027) creaba el registro completo en un solo
-- paso, sin ningún control de cuándo el técnico realmente empezó a trabajar ese
-- día. Se agrega un ciclo real de apertura/cierre (igual patrón que ya existe
-- para el turno de caja del cajero, CashRegisterEntity): el técnico abre su
-- jornada (started_at + ubicación GPS inicial opcional) y el cierre de caja
-- chica diario ahora exige que exista una jornada abierta ese día.
-- Esquema: tickets.daily_closures
-- ==============================================================================

ALTER TABLE "tickets"."daily_closures"
  ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "start_latitude" DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "start_longitude" DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP WITH TIME ZONE;

-- Backfill de filas existentes (si las hubiera antes de este cambio): se
-- consideran ya iniciadas y cerradas en el momento en que fueron creadas,
-- para no dejar jornadas históricas en un estado "abierto" inconsistente.
UPDATE "tickets"."daily_closures"
SET "started_at" = "created_at", "closed_at" = "created_at"
WHERE "started_at" IS NULL;
