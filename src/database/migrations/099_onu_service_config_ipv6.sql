-- ==============================================================================
-- MIGRACIÓN 099: soporte de lectura y asignación IPv6 en net.onu_service_config
-- (Fase 3 de Plan_Implementacion_IPv6_Dual_Stack_WAN.md).
-- Columnas para persistir prefijo delegado y dirección WAN IPv6 asignados
-- por PPPoE en tiempo de ejecución (readback), y campos para configuración
-- de direccionamiento estático IPv6 cuando aplique.
-- ==============================================================================

ALTER TABLE "net"."onu_service_config"
  ADD COLUMN IF NOT EXISTS "pppoe_ipv6_prefix" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "pppoe_ipv6_address" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "wan_static_ipv6" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "wan_static_ipv6_prefix_len" INT,
  ADD COLUMN IF NOT EXISTS "wan_static_ipv6_gw" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "wan_static_ipv6_dns1" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "wan_static_ipv6_dns2" VARCHAR(100);

COMMENT ON COLUMN "net"."onu_service_config"."pppoe_ipv6_prefix" IS
  'Prefijo IPv6 delegado asignado por el servidor PPPoE/ISP tras la negociación IPv6CP (confirmado por readback TR-069).';

COMMENT ON COLUMN "net"."onu_service_config"."pppoe_ipv6_address" IS
  'Dirección WAN IPv6 asignada a la interfaz PPP del ONT tras la negociación IPv6CP.';
