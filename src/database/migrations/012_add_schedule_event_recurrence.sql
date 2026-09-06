-- Migracion 012: Agregar soporte para eventos e hitos recurrentes y bloqueos de calendario
ALTER TABLE "tickets"."schedule_events" 
ADD COLUMN IF NOT EXISTS "is_recurring" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS "recurrence_type" VARCHAR(30) NOT NULL DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS "recurrence_day" INT NULL,
ADD COLUMN IF NOT EXISTS "is_hard_block" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS "is_locked" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "idx_schedule_events_recurrence" 
ON "tickets"."schedule_events" ("is_recurring", "recurrence_type", "recurrence_day");

-- Sembrar hito fijo mensual de cobro/corte los dias 25 de cada mes si no existe
INSERT INTO "tickets"."schedule_events" (
  "id", "title", "description", "type", "scope", "event_date", "start_time", 
  "duration_minutes", "is_all_day", "color", "is_recurring", "recurrence_type", 
  "recurrence_day", "is_hard_block", "is_locked", "created_by_user_id", "created_at", "updated_at"
)
SELECT 
  gen_random_uuid(),
  'Cobro Masivo & Corte de Facturacion (Dia 25)',
  'Hito mensual inmutable: Ejecucion de cortes automaticos, cobro de facturas y soporte preferencial de pagos en sucursal y campo.',
  'FECHA_PAGO',
  'GLOBAL',
  CURRENT_DATE,
  '08:00',
  600,
  TRUE,
  'amber',
  TRUE,
  'MONTHLY_DAY',
  25,
  TRUE,
  TRUE,
  (SELECT "id" FROM "sec"."users" LIMIT 1),
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "tickets"."schedule_events" 
  WHERE "is_recurring" = TRUE AND "recurrence_type" = 'MONTHLY_DAY' AND "recurrence_day" = 25
);
