-- ==============================================================================
-- MIGRACIÓN 034: Empleados sin acceso al sistema
-- Hasta ahora todo empleado exigía un usuario con login (user_id NOT NULL).
-- La empresa también tiene colaboradores que no necesitan acceso al ERP (ej.
-- conserjería) — se permite un perfil de empleado sin usuario vinculado.
-- Esquema: sec.employees
-- ==============================================================================

ALTER TABLE "sec"."employees"
  ALTER COLUMN "user_id" DROP NOT NULL;

-- Si se elimina el usuario de un empleado que sí tenía acceso, el perfil de
-- RRHH (cédula, cargo, salario, historial) no debe desaparecer con él — antes
-- era ON DELETE CASCADE, ahora el vínculo simplemente se limpia. El nombre de
-- la FK lo generó TypeORM automáticamente (no es estable entre entornos), así
-- que se busca dinámicamente en vez de asumir un nombre fijo.
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'sec.employees'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE '%user_id%sec.users%';

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "sec"."employees" DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE "sec"."employees"
    ADD CONSTRAINT "fk_employees_user_id"
      FOREIGN KEY ("user_id") REFERENCES "sec"."users"("id") ON DELETE SET NULL;
END $$;
