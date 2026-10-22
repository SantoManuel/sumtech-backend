-- ==============================================================================
-- MIGRACIÓN 094: DNS manual para la WAN de la ONU (net.onu_service_config)
-- ==============================================================================
--
-- POR QUÉ: la Etapa 3 (Configurar WAN/PPPoE) solo cubría usuario/contraseña
-- PPPoE e IP/máscara/gateway para modo Estática -- comparado contra el
-- formulario real de SmartOLT (referencia tomada en vivo, 2026-10-22), le
-- faltaba el override manual de DNS, un campo real y confirmado en el árbol
-- de parámetros TR-069 de las ONUs de este OLT (WANPPPConnection.DNSServers/
-- DNSOverrideAllowed, WANIPConnection.DNSServers/DNSOverrideAllowed -- ambos
-- verificados en vivo contra CMDCDD4D131E el mismo día).
-- ==============================================================================

ALTER TABLE "net"."onu_service_config"
  ADD COLUMN IF NOT EXISTS "wan_dns1" VARCHAR(45) NULL,
  ADD COLUMN IF NOT EXISTS "wan_dns2" VARCHAR(45) NULL;

COMMENT ON COLUMN "net"."onu_service_config"."wan_dns1" IS
  'DNS primario a forzar en la WAN del CPE (DNSOverrideAllowed=true + DNSServers vía TR-069). NULL = usa el DNS que entregue el ISP/PPPoE normalmente.';
COMMENT ON COLUMN "net"."onu_service_config"."wan_dns2" IS
  'DNS secundario a forzar en la WAN del CPE. Solo tiene efecto si wan_dns1 también está definido.';
