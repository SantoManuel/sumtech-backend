-- ==============================================================================
-- MIGRACIÓN 083: DNS por defecto para perfiles PPP sincronizados en un nodo
-- ==============================================================================
--
-- POR QUÉ: los perfiles PPP sincronizados desde el catálogo de planes
-- (PppManagementService.syncCatalogProfilesToNode) nunca entregaban
-- dns-server por IPCP a los clientes PPPoE — un cliente con internet
-- funcionando no podía resolver NINGÚN nombre de dominio (incluyendo el ACS
-- de TR-069), solo IPs directas. Mismo patrón que default_parent_queue /
-- default_ppp_pool: un default por nodo, con override opcional por lote de
-- sincronización (ver SyncCatalogProfilesDto.dnsServersOverride).
-- ==============================================================================

ALTER TABLE "net"."network_nodes"
  ADD COLUMN IF NOT EXISTS "default_dns_servers" VARCHAR(255) NULL;

COMMENT ON COLUMN "net"."network_nodes"."default_dns_servers" IS
  'Servidores DNS por defecto para los perfiles PPP sincronizados en este nodo, formato RouterOS (ej. "8.8.8.8,1.1.1.1"). Sin esto los clientes PPPoE no pueden resolver nombres de dominio.';
