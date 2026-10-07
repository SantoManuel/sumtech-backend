-- ==============================================================================
-- MIGRACIÓN 072: Soporte para recuperación de contraseñas de usuarios (sec.users)
-- Agrega columnas para almacenar el hash del token de reseteo (SHA-256) y
-- la fecha/hora de expiración estricta para autoservicio de cambio de contraseña.
-- ==============================================================================

ALTER TABLE "sec"."users"
  ADD COLUMN IF NOT EXISTS "reset_password_token_hash" VARCHAR(128) NULL,
  ADD COLUMN IF NOT EXISTS "reset_password_expires_at" TIMESTAMP WITH TIME ZONE NULL;

CREATE INDEX IF NOT EXISTS "idx_users_reset_password_token_hash"
  ON "sec"."users" ("reset_password_token_hash")
  WHERE "reset_password_token_hash" IS NOT NULL;
