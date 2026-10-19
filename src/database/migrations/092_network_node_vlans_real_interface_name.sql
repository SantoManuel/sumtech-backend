-- ==============================================================================
-- MIGRACIÓN 092: Nombre REAL de la sub-interfaz VLAN en RouterOS
-- (net.network_node_vlans.interface_name)
-- ==============================================================================
--
-- POR QUÉ: "uplink_interface" guarda el puerto FÍSICO padre (ej. "sfp1"), no
-- el nombre de la propia sub-interfaz VLAN (/interface/vlan) -- esos son dos
-- objetos distintos en RouterOS. Para VLANs creadas por Sumtech
-- (syncVlan()) el nombre de la sub-interfaz siempre sigue la convención
-- "vlan<N>", así que nunca hizo falta guardarlo aparte. Pero para VLANs
-- importadas desde el descubrimiento brownfield (importDiscoveredVlan(),
-- ya existían en el router antes de Sumtech) ese nombre real NUNCA se
-- capturó -- confirmado en vivo contra Nodo_Tabara_Abajo: sus 9 VLANs
-- reales se llaman "VLAN-400-PPOE", "VLAN805 IPTV TORO", "Vlan46_TR069",
-- etc., nada parecido a "vlan400". Cualquier función que reconstruyera el
-- nombre como "vlan<N>" (ensureDhcpServerForVlan, ensurePppoeServerForVlan,
-- getVlanServiceStatuses, scanRealVlanPools) fallaba en silencio para
-- estas VLANs reales -- síntoma real reportado: "Detectar desde RouterOS"
-- respondía "no se pudo detectar" para las 9 VLANs de ese nodo.
--
-- Nullable: las filas ya existentes se completan en un backfill aparte (no
-- generalizable vía SQL puro -- requiere consultar el router real).
-- ==============================================================================

ALTER TABLE "net"."network_node_vlans"
  ADD COLUMN IF NOT EXISTS "interface_name" VARCHAR(100) NULL;

COMMENT ON COLUMN "net"."network_node_vlans"."interface_name" IS
  'Nombre REAL de la sub-interfaz VLAN en RouterOS (/interface/vlan), distinto de uplink_interface (el puerto físico padre). Para VLANs creadas por Sumtech sigue la convención "vlan<N>"; para VLANs importadas por descubrimiento brownfield es el nombre que ya tenía en el router (puede ser cualquier texto).';
