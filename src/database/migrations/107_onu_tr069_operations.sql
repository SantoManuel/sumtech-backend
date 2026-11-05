-- Tenant migration. No OLT commands and no historical success backfill.
CREATE TABLE IF NOT EXISTS net.onu_tr069_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onu_id uuid NOT NULL REFERENCES net.onus(id) ON DELETE CASCADE,
  kind varchar(12) NOT NULL CHECK (kind IN ('profile','acs')),
  version integer NOT NULL,
  request_key varchar(100) NOT NULL,
  fingerprint varchar(64) NOT NULL,
  payload_enc text,
  status varchar(30) NOT NULL CHECK (status IN ('queued','running','failed','partial','applied_unverified','verified')),
  stage varchar(40) NOT NULL DEFAULT 'queued',
  result jsonb,
  actor_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  next_check_at timestamptz,
  verification_checks integer NOT NULL DEFAULT 0,
  target_acs_url varchar(255) NOT NULL,
  serial_number varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (onu_id, request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tr069_active_onu ON net.onu_tr069_operations(onu_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_tr069_recovery ON net.onu_tr069_operations(status, next_check_at);
