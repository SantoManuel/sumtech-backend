-- ==============================================================================
-- MIGRACIÓN 080: VLAN del acceso de cliente + medio de suspensión DHCP
-- (Fase D del plan de automatización del Core/Gateway MikroTik)
-- ==============================================================================
--
-- POR QUÉ: DHCP como alternativa completa a PPPoE necesita saber en qué VLAN
-- vive el cliente, para resolver el servidor DHCP/pool correcto en el
-- router (a diferencia de PPPoE, donde el pool ya está implícito en el
-- perfil PPP). `suspension_medium`/`suspension_medium_override` ya eran
-- VARCHAR(30), así que 'DHCP' entra sin necesidad de ensanchar la columna —
-- solo se documenta el nuevo valor aceptado a nivel de aplicación.
-- ==============================================================================

ALTER TABLE "net"."network_access"
  ADD COLUMN IF NOT EXISTS "vlan_id" UUID NULL REFERENCES "net"."vlans"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "net"."network_nodes"."suspension_medium" IS
  'PPPOE: secret PPPoE (ppp/secret). OLT_NATIVE: bloqueo óptico del ONU. DHCP: lease estática + simple-queue en el router (alternativa completa a PPPoE para clientes sin autenticación PPPoE).';
