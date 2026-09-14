-- ==============================================================================
-- MIGRACIÓN 029: Permitir Múltiples Jornadas por Día para Técnicos de Campo
-- La migración 027 fijó UNIQUE ("employee_id", "closure_date"), limitando a un
-- único cierre por técnico por día de calendario.
-- Se elimina dicha restricción para soportar turnos partidos, emergencias o
-- reaperturas tras cierre, y se crea un índice único parcial que garantiza que
-- un técnico SOLO PUEDA TENER UNA JORNADA ABIERTA simultáneamente (WHERE closed_at IS NULL).
-- Esquema: tickets.daily_closures
-- ==============================================================================

-- 1. Si existieran múltiples jornadas abiertas para un mismo técnico debido a pruebas previas,
-- se cierran las más antiguas conservando abierta únicamente la más reciente.
WITH ranked_open AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY created_at DESC) as rn
  FROM "tickets"."daily_closures"
  WHERE "closed_at" IS NULL
)
UPDATE "tickets"."daily_closures"
SET "closed_at" = "created_at"
WHERE id IN (
  SELECT id FROM ranked_open WHERE rn > 1
);

-- 2. Eliminar la restricción de 1 registro por técnico por fecha calendario
ALTER TABLE "tickets"."daily_closures"
  DROP CONSTRAINT IF EXISTS "uq_daily_closures_employee_date";

-- 3. Crear índice único condicional: un técnico solo puede tener 1 jornada activa (abierta) a la vez
DROP INDEX IF EXISTS "tickets"."uq_daily_closures_active_employee";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_daily_closures_active_employee"
  ON "tickets"."daily_closures" ("employee_id")
  WHERE "closed_at" IS NULL;
