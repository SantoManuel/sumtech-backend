/**
 * ARCHIVO: src/modules/auth/interfaces/jwt-payload.interface.ts
 * RESPONSABILIDAD: Contrato tipado del contenido codificado dentro del JWT.
 * PROPIEDADES:
 * - sub: string (ID del usuario)
 * - username: string
 * - email: string
 * - roles: string[]
 * - employeeId?: string
 * - tenantId: string (tenant resuelto por subdominio al momento del login — Fase 2 multitenant)
 * - tenantSlug: string
 * - iat?: number
 * - exp?: number
 */
export interface JwtPayload {
  sub: string;
  username: string;
  email: string;
  roles: string[];
  employeeId?: string;
  clientId?: string;
  tenantId: string;
  tenantSlug: string;
  iat?: number;
  exp?: number;
}

