-- MIGRACIÓN 068: Días de gracia específicos por contrato (Fase 7 - RF-BILL-001)

ALTER TABLE com.contracts
  ADD COLUMN IF NOT EXISTS grace_days_override INTEGER NULL;

COMMENT ON COLUMN com.contracts.grace_days_override IS 'Días de gracia específicos para este contrato. Si es NULL, se usa la configuración global del tenant (settings.graceDaysBeforeSuspension).';
