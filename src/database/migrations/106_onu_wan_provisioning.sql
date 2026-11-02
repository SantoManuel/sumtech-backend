-- Additive tenant migration. No device commands or historical confirmation.
ALTER TABLE net.onu_service_config
  ADD COLUMN IF NOT EXISTS wan_provisioning_method varchar(20),
  ADD COLUMN IF NOT EXISTS wan_applied_method varchar(20),
  ADD COLUMN IF NOT EXISTS wan_desired_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wan_applied_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wan_apply_status varchar(30) NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN IF NOT EXISTS wan_last_error text,
  ADD COLUMN IF NOT EXISTS wan_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS omci_wan_profile jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onu_wan_method_check' AND conrelid = 'net.onu_service_config'::regclass) THEN
    ALTER TABLE net.onu_service_config ADD CONSTRAINT onu_wan_method_check
      CHECK (wan_provisioning_method IN ('OMCI', 'TR069') AND (wan_applied_method IS NULL OR wan_applied_method IN ('OMCI', 'TR069')));
    ALTER TABLE net.onu_service_config ADD CONSTRAINT onu_wan_status_check
      CHECK (wan_apply_status IN ('NOT_CONFIGURED','PENDING','APPLYING','QUEUED','VERIFYING','APPLIED','ERROR','UNKNOWN'));
    UPDATE net.onu_service_config SET wan_provisioning_method = 'TR069', wan_apply_status = 'UNKNOWN'
      WHERE management_method = 'TR069' AND tr069_network_id IS NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS net.onu_wan_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onu_id uuid NOT NULL REFERENCES net.onus(id) ON DELETE CASCADE,
  version integer NOT NULL,
  method varchar(20) NOT NULL CHECK (method IN ('OMCI','TR069')),
  status varchar(30) NOT NULL,
  actor varchar(100),
  attempts integer NOT NULL DEFAULT 1,
  request_fingerprint varchar(64) NOT NULL,
  last_error text,
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (onu_id, version)
);
CREATE INDEX IF NOT EXISTS idx_onu_wan_operations_latest ON net.onu_wan_operations(onu_id, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_onu_wan_operations_version ON net.onu_wan_operations(onu_id, version);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='onu_wan_operation_status_check' AND conrelid='net.onu_wan_operations'::regclass) THEN
    ALTER TABLE net.onu_wan_operations ADD CONSTRAINT onu_wan_operation_status_check
      CHECK (status IN ('NOT_CONFIGURED','PENDING','APPLYING','QUEUED','VERIFYING','APPLIED','ERROR','UNKNOWN'));
  END IF;
END $$;

-- Covers UI, imports and future writers of the credential source of truth.
CREATE OR REPLACE FUNCTION net.invalidate_onu_wan_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  IF NEW.username IS NOT DISTINCT FROM OLD.username AND NEW.pppoe_password_enc IS NOT DISTINCT FROM OLD.pppoe_password_enc THEN RETURN NEW; END IF;
  FOR target IN SELECT id FROM net.onus WHERE contract_id = NEW.contract_id ORDER BY id LOOP
    -- Same database-local lock used by every backend WAN writer. Serialize credential changes with I/O.
    PERFORM pg_advisory_xact_lock(hashtextextended('sumtech:wan:' || target::text, 0));
    UPDATE net.onu_wan_operations SET status='ERROR', last_error='Las credenciales del acceso cambiaron.', finished_at=now()
      WHERE onu_id=target AND version >= 0 AND status IN ('PENDING','APPLYING','QUEUED','VERIFYING','UNKNOWN');
    UPDATE net.onu_service_config SET wan_desired_version=wan_desired_version+1,
      wan_apply_status='PENDING', wan_last_error='Credenciales actualizadas; pendiente de aplicar.',
      cpe_config_status='PENDING', wan_verified_at=NULL
      WHERE onu_id=target AND wan_provisioning_method IS NOT NULL;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_onu_wan_credentials ON net.network_access;
CREATE TRIGGER trg_onu_wan_credentials AFTER UPDATE OF username, pppoe_password_enc ON net.network_access
  FOR EACH ROW EXECUTE FUNCTION net.invalidate_onu_wan_credentials();
