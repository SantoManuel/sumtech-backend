/**
 * Claves canónicas de `SaasPlanEntity.features` (jsonb) que hoy tienen un
 * `@RequireFeature(...)` real gateando rutas — antes solo vivían como
 * ejemplo en el JSDoc de `require-feature.decorator.ts`. `hasFeature()` en
 * `TenantContextService` hace match case-insensitive, así que el valor
 * exacto de la clave (mayúsculas aquí) es una convención, no una validación.
 *
 * Storage/MinIO queda deliberadamente fuera de esta lista: es infraestructura
 * transversal (logos, certificados DGII, fotos de tickets) usada por módulos
 * core, no un módulo opcional vendible por plan — gatearla rompería
 * funcionalidad que no tiene relación con "planes".
 */
export const SAAS_FEATURE_KEYS = ['GENIEACS', 'MIKROTIK', 'CRM', 'OLT', 'CAPTIVE_PORTAL'] as const;

export type SaasFeatureKey = (typeof SAAS_FEATURE_KEYS)[number];
