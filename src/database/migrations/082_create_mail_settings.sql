-- ==============================================================================
-- MIGRACIÓN 082: Configuración SMTP propia por tenant (sec.mail_settings)
-- ==============================================================================
-- POR QUÉ: el envío de correo (recordatorios/SLA/encuestas del CRM, reset de
-- contraseña) usaba una única cuenta SMTP global (variables de entorno),
-- compartida por todos los tenants de este SaaS. Esta tabla permite que cada
-- tenant cargue su propia cuenta de correo saliente; si no la configura
-- (enabled=false o fila inexistente), el sistema sigue usando el SMTP global
-- como respaldo — ver MailService.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "sec"."mail_settings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "smtp_host" VARCHAR(255) NULL,
  "smtp_port" INT NOT NULL DEFAULT 587,
  "smtp_user" VARCHAR(255) NULL,
  "smtp_pass_enc" TEXT NULL,
  "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
  "from_address" VARCHAR(255) NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "sec"."mail_settings" IS
  'Configuración SMTP propia del tenant (una sola fila, singleton por convención de aplicación igual que sec.company_profile). smtp_pass_enc cifrado en reposo vía transformer de columna (ver secret-crypto.util.ts).';
