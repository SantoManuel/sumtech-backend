-- 050_add_pending_portal_password_and_credentials_report.sql
-- El usuario/contraseña del Portal de Autoservicio debe quedar impreso en el
-- contrato del cliente. Como la contraseña se hashea (bcrypt, de un solo
-- sentido) al generarse, se guarda en texto plano SOLO transitoriamente —
-- hasta que se imprime el primer contrato del cliente, momento en el que se
-- limpia (pending_portal_password = NULL). Nunca se expone por defecto en
-- consultas (ver ClientEntity: select: false), igual que password_hash.
ALTER TABLE "com"."clients"
    ADD COLUMN IF NOT EXISTS "pending_portal_password" VARCHAR(20);

-- Reporte de credenciales de una importación masiva (usuario/contraseña por
-- cada cliente creado en el batch) — se genera una sola vez al terminar el
-- procesamiento y se sube a MinIO; este campo guarda el object key.
ALTER TABLE "com"."client_import_batches"
    ADD COLUMN IF NOT EXISTS "credentials_report_object_key" VARCHAR(255);
