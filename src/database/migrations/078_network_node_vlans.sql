-- ==============================================================================
-- MIGRACIÓN 078: Tabla de VLANs materializadas por nodo MikroTik (Fase A del
-- plan de configuración base del Core/Gateway — ver Plan de automatización
-- MikroTik en el roadmap SaaS)
-- ==============================================================================
--
-- POR QUÉ ESTA TABLA:
--
-- Hoy la VLAN de servicio (net.vlans) ya se materializa del lado OLT
-- (net.olt_interface_vlans) y del lado ONU (comandos reales ya implementados
-- en los drivers). Del lado MikroTik no existe nada — ninguna VLAN se crea
-- en el router. Esta tabla es el equivalente de net.olt_interface_vlans pero
-- para el nodo MikroTik: registra qué VLAN debe existir sobre qué interfaz
-- física del router (típicamente el puerto que conecta a la OLT) y permite
-- distinguir "lo que debería estar configurado" de "lo que de verdad se
-- aplicó" (apply_status), mismo patrón ya usado en olt_interface_vlans.
--
-- En RouterOS no existe un "modo trunk" explícito: una VLAN es una
-- sub-interfaz (/interface/vlan) sobre el puerto físico, así que un puerto
-- con varias filas de esta tabla apuntando a él YA ES, por definición, un
-- puerto trunk — no hace falta una columna ni un concepto aparte para eso.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "net"."network_node_vlans" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" UUID NOT NULL REFERENCES "net"."network_nodes"("id") ON DELETE CASCADE,
  "vlan_id" UUID NOT NULL REFERENCES "net"."vlans"("id") ON DELETE RESTRICT,
  "uplink_interface" VARCHAR(50) NOT NULL,
  "gateway_cidr" VARCHAR(45) NULL,
  "apply_status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "last_sync_at" TIMESTAMPTZ NULL,
  "last_sync_error" TEXT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("node_id", "vlan_id")
);

COMMENT ON COLUMN "net"."network_node_vlans"."apply_status" IS
  'PENDING: registrada pero nunca sincronizada contra el router real. APPLIED: la última sincronización confirmó la sub-interfaz VLAN y la IP de gateway en RouterOS. ERROR: la última sincronización falló (ver last_sync_error).';

COMMENT ON COLUMN "net"."network_node_vlans"."gateway_cidr" IS
  'IP de gateway para esta VLAN en este nodo, formato RouterOS (ej. "10.20.0.1/24"). Se asigna a la sub-interfaz VLAN vía /ip/address. Nullable porque algunas VLANs (ej. solo trunk de paso) pueden no necesitar IP en este nodo.';
