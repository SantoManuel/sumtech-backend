-- ==============================================================================
-- MIGRACIÓN 085: ISC 10% (Impuesto Selectivo al Consumo a las Telecomunicaciones)
-- + tasas de CDT/ISC configurables en Cargos de Servicio + columnas de montos
-- faltantes en pos.sales / pos.sale_details / pos.invoices para que el ad-hoc
-- de POS pueda llevar CDT/ISC igual que la facturación recurrente.
-- Ver Plan_Implementacion_CDT_ISC_Impuestos.md (sección 2) para el detalle.
-- ==============================================================================

ALTER TABLE "com"."plans"
  ADD COLUMN IF NOT EXISTS "isc_rate" DECIMAL(4,2) NOT NULL DEFAULT 0;

-- Default correcto por tipo de servicio para planes ya existentes: el Internet
-- está excluido del ISC de telecomunicaciones (Ley 253-12); TV/DUAL sí lleva
-- el 10%. Nuevos planes reciben este mismo default desde PlansService.create().
UPDATE "com"."plans" SET "isc_rate" = 0.10 WHERE "service_type" IN ('TV', 'DUAL');

ALTER TABLE "com"."service_fees"
  ADD COLUMN IF NOT EXISTS "cdt_rate" DECIMAL(4,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isc_rate" DECIMAL(4,2) NOT NULL DEFAULT 0;

ALTER TABLE "pos"."sales"
  ADD COLUMN IF NOT EXISTS "cdt_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isc_total" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "pos"."sale_details"
  ADD COLUMN IF NOT EXISTS "cdt_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isc_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "pos"."invoices"
  ADD COLUMN IF NOT EXISTS "isc_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
