-- ==============================================================================
-- MIGRACIÓN 027: Cierre de Jornada del Técnico de Campo
-- Un único registro por técnico por día ("cierre de caja chica diario") que
-- unifica el combustible consumido y los demás gastos operativos (peajes,
-- reparaciones, etc.), cada uno con su foto de factura (almacenada en MinIO —
-- solo se guarda el object key, nunca una URL pública). Sin flujo de
-- aprobación: es un registro de consulta para Admin/Gerencia.
-- Esquema: tickets.daily_closures, tickets.daily_closure_expenses
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "tickets"."daily_closures" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "sec"."employees"("id"),
  "closure_date" DATE NOT NULL,
  "fuel_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "total_expenses_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_daily_closures_employee_date" UNIQUE ("employee_id", "closure_date")
);

CREATE TABLE IF NOT EXISTS "tickets"."daily_closure_expenses" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "daily_closure_id" UUID NOT NULL REFERENCES "tickets"."daily_closures"("id") ON DELETE CASCADE,
  "concept" VARCHAR(150) NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "receipt_photo_key" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_daily_closure_expenses_closure_id" ON "tickets"."daily_closure_expenses" ("daily_closure_id");
CREATE INDEX IF NOT EXISTS "idx_daily_closures_employee_id" ON "tickets"."daily_closures" ("employee_id");
