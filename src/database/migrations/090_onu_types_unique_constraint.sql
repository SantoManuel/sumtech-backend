-- ==============================================================================
-- MIGRACIÓN 090: Restricción UNIQUE real en net.onu_types(vendor, model)
-- ==============================================================================
--
-- POR QUÉ: la migración 064 creó esta tabla asumiendo UNIQUE(vendor, model) y
-- sembró 4 modelos GPON con "ON CONFLICT (vendor, model) DO NOTHING" -- pero
-- esa restricción NUNCA existió realmente en producción (confirmado con
-- "\d net.onu_types": solo hay PK en id). Por eso ese INSERT falló en
-- silencio y el catálogo GPON quedó vacío (ver análisis del 2026-10-19,
-- Plan_Implementacion_Catalogo_Tipos_ONU.md Fase 1).
--
-- Esta es la ÚLTIMA migración que toca esta tabla: de aquí en adelante, un
-- modelo de ONU nuevo se carga desde el CRUD real (POST/PATCH/DELETE
-- /olt/onu-types + modal de administración), nunca con un .sql nuevo.
-- ==============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'onu_types_vendor_model_unique'
  ) THEN
    ALTER TABLE net.onu_types
      ADD CONSTRAINT onu_types_vendor_model_unique UNIQUE (vendor, model);
  END IF;
END $$;
