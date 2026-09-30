import { SetMetadata } from '@nestjs/common';

export const REQUIRE_FEATURE_KEY = 'REQUIRE_FEATURE_KEY';

/**
 * Decorador para restringir endpoints o controladores según los módulos/features
 * contratados en SaasPlanEntity del tenant activo.
 *
 * Ejemplos:
 *   @RequireFeature('GENIEACS')
 *   @RequireFeature('MIKROTIK')
 *   @RequireFeature('CRM')
 */
export const RequireFeature = (featureKey: string) => SetMetadata(REQUIRE_FEATURE_KEY, featureKey);
