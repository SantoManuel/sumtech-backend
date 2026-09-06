-- ==============================================================================
-- MIGRACIÓN 017: Semilla de Categorías para Activos Fijos, Herramientas y Mobiliario
-- ==============================================================================

INSERT INTO "inv"."categories" ("code", "name", "article_type", "default_requires_serial", "description")
SELECT * FROM (VALUES
  ('COMPUTING', 'Equipos de Cómputo (PC / Monitores)', 'FIXED_ASSET'::"inv"."categories_article_type_enum", TRUE, 'Laptops, monitores y CPUs asignados a empleados u oficinas'),
  ('SERVERS', 'Servidores e Infraestructura de Red', 'FIXED_ASSET'::"inv"."categories_article_type_enum", TRUE, 'Servidores de datacenter, switches troncales y routers de borde'),
  ('VEHICLES', 'Vehículos y Camionetas de Flotilla', 'FIXED_ASSET'::"inv"."categories_article_type_enum", TRUE, 'Camionetas y motocicletas de brigadas técnicas (identificadas por placa/chasis)'),
  ('FURNITURE', 'Mobiliario y Equipamiento de Oficina', 'FIXED_ASSET'::"inv"."categories_article_type_enum", FALSE, 'Escritorios, sillas ergonómicas, estanterías de bodega'),
  ('TOOLS_FIELD', 'Herramientas Operativas de Campo', 'TOOL_ASSET'::"inv"."categories_article_type_enum", TRUE, 'Fusionadoras de fibra, OTDRs, escaleras de extensión y taladros')
) AS seed(code, name, article_type, default_requires_serial, description)
WHERE NOT EXISTS (SELECT 1 FROM "inv"."categories" WHERE "code" = seed.code);
