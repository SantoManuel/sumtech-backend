/**
 * ARCHIVO: src/modules/auth/interfaces/jwt-payload.interface.ts
 * RESPONSABILIDAD: Contrato tipado del contenido codificado dentro del JWT.
 * PROPIEDADES:
 * - sub: string (ID del usuario)
 * - username: string
 * - email: string
 * - roles: string[]
 * - employeeId?: string
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
  iat?: number;
  exp?: number;
}

