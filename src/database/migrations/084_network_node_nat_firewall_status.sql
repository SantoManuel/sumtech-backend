-- ==============================================================================
-- MIGRACIÓN 084: estado persistido de NAT Masquerade y Firewall Baseline
-- ==============================================================================
--
-- POR QUÉ: NetworkNodeInfrastructureService.ensureNatMasquerade() y
-- ensureFirewallBaseline() ya aplican la configuración real en RouterOS, pero
-- no dejaban rastro de si/cuándo se aplicó ni de un error, a diferencia de
-- ensureWan() que sí persiste wan_last_sync_at/wan_last_sync_error. El modal
-- "Infraestructura & Servicios RouterOS" (/dashboard/red) no tenía forma de
-- mostrar si NAT/Firewall ya estaban aplicados sin volver a llamarlos. Mismo
-- patrón exacto que las columnas wan_last_sync_* ya existentes (migración 079).
-- ==============================================================================

ALTER TABLE "net"."network_nodes"
  ADD COLUMN IF NOT EXISTS "nat_last_sync_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "nat_last_sync_error" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "firewall_baseline_last_sync_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "firewall_baseline_last_sync_error" TEXT NULL;

COMMENT ON COLUMN "net"."network_nodes"."nat_last_sync_at" IS
  'Última vez que se aseguró con éxito la regla NAT Masquerade (sumtech-nat-masquerade) en este nodo.';
COMMENT ON COLUMN "net"."network_nodes"."nat_last_sync_error" IS
  'Error del último intento de asegurar NAT Masquerade, si falló. Se limpia en el siguiente intento exitoso.';
COMMENT ON COLUMN "net"."network_nodes"."firewall_baseline_last_sync_at" IS
  'Última vez que se aplicó con éxito el set fijo de reglas de firewall baseline en este nodo.';
COMMENT ON COLUMN "net"."network_nodes"."firewall_baseline_last_sync_error" IS
  'Error del último intento de aplicar el firewall baseline, si falló. Se limpia en el siguiente intento exitoso.';
