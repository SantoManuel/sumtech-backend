CREATE TABLE IF NOT EXISTS platform.genieacs_identity_claims (
  device_id varchar(255) PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  onu_id uuid NOT NULL,
  management_mac varchar(12),
  method varchar(10) NOT NULL CHECK (method IN ('SERIAL','MAC')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, onu_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_genieacs_claim_mac ON platform.genieacs_identity_claims(management_mac) WHERE management_mac IS NOT NULL;
