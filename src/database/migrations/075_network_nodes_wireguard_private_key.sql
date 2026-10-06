-- ==============================================================================
-- MIGRACIÓN 075: Llave privada WireGuard generada por el backend (Fase A del
-- plan de producción WireGuard — ver Plan_WireGuard_Produccion.md)
-- ==============================================================================
--
-- POR QUÉ ESTA COLUMNA:
--
-- Hasta ahora el script RouterOS generado (`wireguard-manager.service.ts`)
-- dejaba que el propio MikroTik autogenerara su par de llaves al crear la
-- interfaz `wg-sumtech` (sin `private-key=` explícita). Eso significaba que
-- nadie — ni el ERP, ni el admin que debe registrar el peer en el servidor
-- central — conocía la llave pública real del equipo después de correr el
-- script.
--
-- A partir de esta migración, el backend genera el par de llaves (x25519)
-- ANTES de generar el script, lo incrusta explícitamente (`private-key=`) y
-- persiste la pública en la columna existente `wireguard_public_key` y la
-- privada cifrada aquí. Así el ERP y el router siempre coinciden, y el
-- comando para registrar el peer en el hub central se puede generar de forma
-- determinística a partir de un valor que el ERP ya conoce.
--
-- Igual que `api_password_enc`, se cifra con AES-256-GCM
-- (`network-connectivity/utils/crypto.util.ts`) y nunca se desencripta hacia
-- el frontend — solo se usa server-side para construir el script .rsc.
-- ==============================================================================

ALTER TABLE "net"."network_nodes"
  ADD COLUMN IF NOT EXISTS "wireguard_private_key_enc" TEXT NULL;

COMMENT ON COLUMN "net"."network_nodes"."wireguard_private_key_enc" IS
  'Llave privada WireGuard (x25519) generada por el backend, cifrada con AES-256-GCM. NULL en nodos creados antes de esta migración o con método distinto de wireguard; se genera de forma perezosa en el primer GET /wireguard-script.';
