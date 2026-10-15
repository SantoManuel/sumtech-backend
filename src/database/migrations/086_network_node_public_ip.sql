-- ==============================================================================
-- MIGRACIÓN 086: IP pública real del router (para portal cautivo multi-tenant)
-- ==============================================================================
--
-- POR QUÉ: el modo de suspensión NOTICE_PORTAL (portal de aviso) necesita que
-- un cliente suspendido, redirigido por su propio MikroTik a un dst-nat fijo,
-- termine viendo la pantalla de aviso de SU tenant correcto -- no se puede
-- resolver por el Host de la petición (el router no lo reescribe, sigue
-- siendo el del sitio que el cliente quería visitar originalmente). La única
-- señal confiable es la IP de origen con la que el router sale a Internet
-- (masquerade estándar de cualquier NAT), así que se guarda explícitamente
-- por nodo -- distinta de managementIp/wireguardIp, que son para que NOSOTROS
-- administremos el equipo, no necesariamente la misma interfaz.
--
-- Esta columna se replica a platform.node_portal_registry (ver migración
-- platform 003) vía NetworkNodesService, para que el endpoint público
-- /platform/portal-redirect pueda identificar el tenant SOLO por esa IP, sin
-- tocar Traefik ni redesplegar nada por cada tenant nuevo que active el
-- portal cautivo.
-- ==============================================================================

ALTER TABLE "net"."network_nodes"
  ADD COLUMN IF NOT EXISTS "public_ip" VARCHAR(45) NULL;

COMMENT ON COLUMN "net"."network_nodes"."public_ip" IS
  'IP pública con la que este router sale a Internet (masquerade de salida) -- usada para identificar el tenant en el redirector público del portal cautivo, no para administración (eso es managementIp/wireguardIp).';
