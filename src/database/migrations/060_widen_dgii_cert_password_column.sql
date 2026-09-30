-- ============================================================================
-- Migración 060: ampliar dgii_cert_password a TEXT para soportar cifrado en reposo
-- ============================================================================
-- `dgiiCertPassword` (sec.company_profile) pasa a cifrarse con AES-256-GCM vía
-- un transformer de columna de TypeORM (src/common/utils/secret-crypto.util.ts)
-- en vez de guardarse en texto plano. El valor cifrado (IV + authTag + cipher
-- en base64, formato "enc:v1:...") es más largo que la contraseña original y
-- ya no cabe en varchar(200) — se amplía a TEXT.
--
-- No se re-encriptan filas existentes en esta migración (sería lógica de
-- aplicación, no SQL): el transformer detecta el prefijo "enc:v1:" y trata
-- cualquier valor sin ese prefijo como texto plano legacy, devolviéndolo tal
-- cual — el próximo `save()` de esa fila lo cifra automáticamente.
-- ============================================================================

ALTER TABLE "sec"."company_profile"
  ALTER COLUMN "dgii_cert_password" TYPE TEXT;
