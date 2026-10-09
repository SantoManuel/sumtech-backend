-- ==============================================================================
-- MIGRACIÓN 079: Configuración WAN básica por nodo (Fase B del plan de
-- automatización del Core/Gateway MikroTik)
-- ==============================================================================
--
-- POR QUÉ: hasta ahora network_nodes solo modelaba cómo NOSOTROS llegamos al
-- router (WireGuard/DDNS/IP pública para gestión). Estas columnas nuevas son
-- distintas: modelan cómo EL ROUTER llega a Internet a través de su propio
-- proveedor de tránsito (IP estática, DHCP-client, o PPPoE-client con las
-- credenciales que ese proveedor entrega). Nunca confundir
-- wan_pppoe_username/wan_pppoe_password_enc (credenciales que el router usa
-- como CLIENTE hacia el proveedor de tránsito) con el servidor PPPoE que el
-- propio sistema expone a los clientes finales del ISP (ppp/secret, ya
-- existente) — son direcciones opuestas del mismo protocolo.
-- ==============================================================================

ALTER TABLE "net"."network_nodes"
  ADD COLUMN IF NOT EXISTS "wan_interface_name" VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS "wan_mode" VARCHAR(20) NOT NULL DEFAULT 'DHCP_CLIENT',
  ADD COLUMN IF NOT EXISTS "wan_static_ip" VARCHAR(45) NULL,
  ADD COLUMN IF NOT EXISTS "wan_static_gateway" VARCHAR(45) NULL,
  ADD COLUMN IF NOT EXISTS "wan_static_dns" VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS "wan_pppoe_username" VARCHAR(150) NULL,
  ADD COLUMN IF NOT EXISTS "wan_pppoe_password_enc" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "wan_last_sync_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "wan_last_sync_error" TEXT NULL;

COMMENT ON COLUMN "net"."network_nodes"."wan_mode" IS
  'STATIC: IP fija dada por el proveedor de tránsito (usa wan_static_*). DHCP_CLIENT: el router pide IP por DHCP al proveedor. PPPOE_CLIENT: el router se autentica como cliente PPPoE contra el proveedor (usa wan_pppoe_*).';
