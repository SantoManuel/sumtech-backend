-- ==============================================================================
-- MIGRACIÓN 053: Sucursales y Cajas físicas (Fase 5 del módulo de Caja).
--
-- Hasta ahora "caja" era sinónimo de "turno de un cajero" (pos.cash_registers,
-- una fila = un turno), sin ningún concepto de sucursal ni de caja física
-- persistente. Sumtech opera varias sucursales/oficinas en paralelo, así que
-- se introduce:
--   - sec.branches: sucursal/oficina física.
--   - pos.cash_stations: caja física dentro de una sucursal (ej. "Caja 1"),
--     persiste entre turnos — a diferencia de cash_registers, que sigue siendo
--     el turno individual.
-- Un empleado (típicamente CAJERO) queda asignado a una sucursal y, dentro de
-- ella, a una caja por defecto — se completa al darlo de alta en
-- /dashboard/empleados. cash_stations_id en cash_registers registra en qué
-- caja física se abrió cada turno concreto (nullable: turnos históricos y
-- roles sin caja asignada, como ADMIN/GERENTE operando sin sucursal, no
-- rompen con NOT NULL).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "sec"."branches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL,
  "address" TEXT,
  "phone" VARCHAR(30),
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "pos"."cash_stations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "branch_id" UUID NOT NULL REFERENCES "sec"."branches"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_cash_stations_branch_name" UNIQUE ("branch_id", "name")
);

CREATE INDEX IF NOT EXISTS "idx_cash_stations_branch" ON "pos"."cash_stations" ("branch_id");

ALTER TABLE "sec"."employees"
  ADD COLUMN IF NOT EXISTS "branch_id" UUID REFERENCES "sec"."branches"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "default_cash_station_id" UUID REFERENCES "pos"."cash_stations"("id") ON DELETE SET NULL;

ALTER TABLE "pos"."cash_registers"
  ADD COLUMN IF NOT EXISTS "cash_station_id" UUID REFERENCES "pos"."cash_stations"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_cash_registers_cash_station" ON "pos"."cash_registers" ("cash_station_id");

-- Sucursal Principal por defecto — evita dejar la app sin ninguna caja
-- seleccionable el día que se aplique esta migración en un ambiente con
-- cajeros ya operando.
INSERT INTO "sec"."branches" ("name", "address")
SELECT 'Sucursal Principal', NULL
WHERE NOT EXISTS (SELECT 1 FROM "sec"."branches");

INSERT INTO "pos"."cash_stations" ("branch_id", "name")
SELECT b."id", 'Caja 1'
FROM "sec"."branches" b
WHERE b."name" = 'Sucursal Principal'
  AND NOT EXISTS (SELECT 1 FROM "pos"."cash_stations");
