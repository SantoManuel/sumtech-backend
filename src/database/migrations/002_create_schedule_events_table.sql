-- ==============================================================================
-- MIGRACIÓN 002: Crear tabla de eventos y avisos de oficina para Gantt
-- Esquema: tickets.schedule_events
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "tickets"."schedule_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" VARCHAR(150) NOT NULL,
  "description" TEXT,
  "type" VARCHAR(30) NOT NULL CHECK ("type" IN ('REUNION', 'FECHA_PAGO', 'AVISO_GLOBAL', 'MANTENIMIENTO_RED', 'CAPACITACION')),
  "scope" VARCHAR(30) NOT NULL CHECK ("scope" IN ('GLOBAL', 'DEPARTMENT', 'EMPLOYEE')),
  "assigned_employee_id" UUID REFERENCES "sec"."employees"("id") ON DELETE SET NULL,
  "event_date" DATE NOT NULL,
  "start_time" VARCHAR(5), -- ej. '09:00', NULL si is_all_day = true
  "duration_minutes" INTEGER NOT NULL DEFAULT 60,
  "is_all_day" BOOLEAN NOT NULL DEFAULT FALSE,
  "color" VARCHAR(30) DEFAULT 'blue',
  "created_by_user_id" UUID NOT NULL REFERENCES "sec"."users"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Índices para optimizar consultas de rango de fechas en Diagrama de Gantt
CREATE INDEX IF NOT EXISTS "idx_schedule_events_date" ON "tickets"."schedule_events" ("event_date");
CREATE INDEX IF NOT EXISTS "idx_schedule_events_emp" ON "tickets"."schedule_events" ("assigned_employee_id");
CREATE INDEX IF NOT EXISTS "idx_schedule_events_type" ON "tickets"."schedule_events" ("type");
