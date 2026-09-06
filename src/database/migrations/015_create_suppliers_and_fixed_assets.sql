-- ==============================================================================
-- MIGRACIÓN 015: Gestión de Proveedores con RNC y Soporte de Activos Fijos / Inmuebles
-- ==============================================================================

-- 1. Crear Tabla de Proveedores (inv.suppliers) -----------------------------------
CREATE TABLE IF NOT EXISTS "inv"."suppliers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "rnc" VARCHAR(20) NOT NULL UNIQUE,
  "business_name" VARCHAR(200) NOT NULL,
  "trade_name" VARCHAR(200),
  "email" VARCHAR(150),
  "phone" VARCHAR(30),
  "address" TEXT,
  "contact_person" VARCHAR(150),
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "notes" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_suppliers_rnc" ON "inv"."suppliers" ("rnc");
CREATE INDEX IF NOT EXISTS "idx_suppliers_business_name" ON "inv"."suppliers" ("business_name");

-- 2. Semilla de Proveedores Iniciales de Telecomunicaciones y Activos -------------
INSERT INTO "inv"."suppliers" ("rnc", "business_name", "trade_name", "email", "phone", "address", "contact_person", "notes")
SELECT * FROM (VALUES
  ('1-31-88990-2', 'Huawei Technologies Dominicana S.R.L.', 'Huawei', 'ventas.do@huawei.com', '(809) 567-8890', 'Av. Winston Churchill #1099, Torre Acrópolis, Piso 14, Santo Domingo', 'Ing. Carlos Mendoza', 'Proveedor principal de ONTs y OLTs GPON'),
  ('1-30-55443-1', 'ZTE Corporation Dominicana S.R.L.', 'ZTE Dominicana', 'soporte.do@zte.com.cn', '(809) 540-1122', 'Av. Abraham Lincoln #1003, Torre Piantini, Santo Domingo', 'Lic. Laura Peña', 'Proveedor de Decodificadores Android TV y ONTs'),
  ('1-01-22334-5', 'FiberHome Telecomunicaciones del Caribe S.A.S.', 'FiberHome', 'caribe@fiberhome.com', '(809) 683-4455', 'Av. Luperón, Zona Industrial de Herrera, Santo Domingo Oeste', 'Ing. Marcos Rivas', 'Cables drop, splitters y fibra óptica monomodo'),
  ('1-01-99887-6', 'Dell Computer Dominicana S.R.L.', 'Dell Technologies', 'corporativo@dell.com.do', '(809) 227-7700', 'Av. 27 de Febrero #223, Ensanche Naco, Santo Domingo', 'Ing. Rafael Soto', 'Servidores rack PowerEdge y estaciones de trabajo'),
  ('1-02-77665-4', 'Santo Domingo Motors S.A.', 'Santo Domingo Motors', 'flotillas@sdm.com.do', '(809) 540-3800', 'Av. John F. Kennedy esq. Av. Abraham Lincoln, Santo Domingo', 'Lic. José Almonte', 'Flotilla de camionetas de servicio técnico e instalaciones')
) AS seed(rnc, business_name, trade_name, email, phone, address, contact_person, notes)
WHERE NOT EXISTS (SELECT 1 FROM "inv"."suppliers" WHERE "rnc" = seed.rnc);
