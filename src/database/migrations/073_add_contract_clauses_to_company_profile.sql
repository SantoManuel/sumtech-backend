-- Migración 073: Añadir soporte de cláusulas de contrato personalizadas por tenant en sec.company_profile
ALTER TABLE sec.company_profile
ADD COLUMN IF NOT EXISTS contract_clauses TEXT[] NULL;

COMMENT ON COLUMN sec.company_profile.contract_clauses IS 
'Arreglo de cláusulas legales y condiciones del contrato de adhesión del ISP. Si es NULL o vacío, se utiliza la plantilla estándar.';
