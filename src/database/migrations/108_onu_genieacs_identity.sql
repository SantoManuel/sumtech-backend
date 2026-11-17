ALTER TABLE net.onus
  ADD COLUMN IF NOT EXISTS management_mac varchar(12),
  ADD COLUMN IF NOT EXISTS management_mac_source varchar(40),
  ADD COLUMN IF NOT EXISTS management_mac_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS tr069_serial_number varchar(100),
  ADD COLUMN IF NOT EXISTS genieacs_link_method varchar(10),
  ADD COLUMN IF NOT EXISTS genieacs_identity_verified_at timestamptz;
ALTER TABLE net.onus ALTER COLUMN genieacs_device_id TYPE varchar(255);
CREATE INDEX IF NOT EXISTS idx_onus_management_mac ON net.onus(management_mac) WHERE management_mac IS NOT NULL;
-- No inferred backfill: existing mac values may belong to downstream equipment.
CREATE TABLE IF NOT EXISTS net.onu_genieacs_identity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onu_id uuid NOT NULL REFERENCES net.onus(id) ON DELETE CASCADE,
  device_id varchar(255) NOT NULL,
  method varchar(10) NOT NULL,
  management_mac varchar(12),
  tr069_serial_number varchar(100),
  verified_at timestamptz NOT NULL DEFAULT now()
);
