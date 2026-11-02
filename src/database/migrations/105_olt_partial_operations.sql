-- Tenant-local journal; retain historical identities even if an ONU is deleted.
CREATE TABLE IF NOT EXISTS net.olt_partial_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olt_id uuid NOT NULL,
  onu_id uuid,
  operation varchar(80) NOT NULL,
  resource_key varchar(200) NOT NULL,
  expected_state varchar(20) NOT NULL CHECK (expected_state IN ('PRESENT', 'ABSENT')),
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RECONCILED')),
  last_observed_state varchar(20) CHECK (last_observed_state IN ('PRESENT', 'ABSENT', 'UNKNOWN')),
  last_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_olt_partial_operations_pending
  ON net.olt_partial_operations (created_at, id) WHERE status = 'PENDING';
