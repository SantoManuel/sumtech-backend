-- ==============================================================================
-- MIGRACIÓN 038: Refresh Tokens con Rotación y Revocación
-- Hasta ahora el refresh token era completamente stateless: solo se verificaba
-- su firma/expiración, sin persistencia ni forma de revocarlo (logout no hacía
-- nada) ni de rotarlo (el mismo token servía los 7 días completos, sin
-- detección de robo/reuso). Esta tabla guarda el HASH (nunca el token en
-- claro) de cada refresh token emitido, agrupados por family_id para poder
-- revocar toda una cadena de rotación si se detecta que un token ya usado
-- vuelve a presentarse (señal de robo).
-- Esquema: sec.refresh_tokens
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "sec"."refresh_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "sec"."users"("id") ON DELETE CASCADE,
  "family_id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL UNIQUE,
  "replaced_by_token_hash" VARCHAR(64),
  "revoked_at" TIMESTAMP WITH TIME ZONE,
  "user_agent" VARCHAR(300),
  "ip_address" VARCHAR(45),
  "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_family_id" ON "sec"."refresh_tokens" ("family_id");
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user_id" ON "sec"."refresh_tokens" ("user_id");
