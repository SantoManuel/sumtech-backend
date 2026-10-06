-- ==============================================================================
-- MIGRACIÓN 076: Tabla de peers WireGuard (Fase B del plan de producción
-- WireGuard — ver Plan_WireGuard_Produccion.md)
-- ==============================================================================
--
-- POR QUÉ ESTA TABLA:
--
-- La Fase A dejó que el script .rsc generara el par de llaves correcto y
-- mostrara el comando para registrar el peer a mano en el hub central. La
-- Fase B automatiza ese registro vía `sumtech-wg-agent` (repo aparte) y
-- necesita un lugar donde guardar qué se le pidió registrar y el último
-- estado que reportó — sin esto, "verificar conexión" tendría que confiar
-- ciegamente en lo que diga el agente en cada llamada, sin poder distinguir
-- "nunca se registró" de "se registró pero el handshake se cayó".
--
-- Es 1:1 con network_nodes (un nodo WireGuard tiene a lo sumo un peer), pero
-- se modela como tabla aparte (no columnas en network_nodes) porque es
-- estado operativo de la VPN, no configuración del nodo, y porque Fase C del
-- plan maestro prevé lo mismo para OLTs con peer propio.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "net"."wireguard_peers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" UUID NOT NULL UNIQUE REFERENCES "net"."network_nodes"("id") ON DELETE CASCADE,
  "public_key" VARCHAR(64) NOT NULL,
  "tunnel_ip" VARCHAR(45) NOT NULL,
  "allowed_ips" VARCHAR(45) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING_MANUAL',
  "last_handshake_at" TIMESTAMPTZ NULL,
  "last_registration_error" TEXT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN "net"."wireguard_peers"."status" IS
  'PENDING_MANUAL: el agente no pudo registrarlo, el admin debe pegar el comando a mano. REGISTERED: el agente confirmó el alta pero aún no hay handshake. CONNECTED: handshake reciente (<180s). DISCONNECTED: se registró pero el último handshake es viejo o no existe.';
