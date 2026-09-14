-- ==============================================================================
-- MIGRACIÓN 042: corrige el puerto por defecto de nodos y agrega use_https
-- La migración 039 puso api_port DEFAULT 8728 — ese es el puerto de la API
-- BINARIA clásica de RouterOS (protocolo distinto, no usado por este módulo).
-- La REST API que RouterOsClient consume (/rest/...) se sirve por el mismo
-- puerto que WebFig: 443 (www-ssl) u 80 (www) plano. Se corrige el default a
-- 443 y se agrega use_https para poder probar contra nodos (ej. un CHR de
-- prueba) que todavía no tienen www-ssl con certificado configurado.
-- Rollback manual:
--   ALTER TABLE "net"."network_nodes" DROP COLUMN IF EXISTS "use_https";
--   ALTER TABLE "net"."network_nodes" ALTER COLUMN "api_port" SET DEFAULT 8728;
-- ==============================================================================

ALTER TABLE "net"."network_nodes" ALTER COLUMN "api_port" SET DEFAULT 443;

ALTER TABLE "net"."network_nodes"
  ADD COLUMN IF NOT EXISTS "use_https" BOOLEAN NOT NULL DEFAULT TRUE;
