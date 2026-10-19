-- ==============================================================================
-- MIGRACIÓN 091: Pool de IP PPPoE por VLAN (net.network_node_vlans.ppp_pool)
-- ==============================================================================
--
-- POR QUÉ: net.network_nodes.default_ppp_pool asume UN solo pool por nodo
-- completo -- correcto solo si el nodo tiene una única VLAN de servicio. En
-- un ISP real, cada VLAN es su propio segmento L2 con su propia subred, y
-- por lo tanto necesita su propio pool de IP en MikroTik (confirmado en
-- producción: el único pool ya configurado se llama "pool-vlan100",
-- siguiendo exactamente esta convención). Sin esta columna, un nodo con 2+
-- VLANs de servicio solo puede sugerir IPs del mismo pool sin importar la
-- VLAN elegida al configurar un Secret PPPoE -- un bug silencioso de
-- asignación cruzada de subred.
--
-- Nullable y sin reemplazar default_ppp_pool: un nodo de una sola VLAN
-- sigue funcionando igual que antes (fallback al pool default del nodo
-- cuando esta columna no está asignada para la VLAN elegida).
-- ==============================================================================

ALTER TABLE "net"."network_node_vlans"
  ADD COLUMN IF NOT EXISTS "ppp_pool" VARCHAR(100) NULL;

COMMENT ON COLUMN "net"."network_node_vlans"."ppp_pool" IS
  'Nombre del pool de IP (/ip/pool) en RouterOS que debe sugerirse para Secrets PPPoE de clientes en esta VLAN de este nodo. Tiene prioridad sobre network_nodes.default_ppp_pool cuando se indica una VLAN explícita al consultar IPs disponibles.';
