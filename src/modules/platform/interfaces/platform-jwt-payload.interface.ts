import { PlatformRole } from '../enums/platform-role.enum';

// Payload del JWT de plataforma — firmado con PLATFORM_JWT_SECRET, nunca con
// JWT_SECRET de tenants. El claim `scope` es una defensa explícita adicional
// (más allá de que el secreto ya sea distinto) para que nunca se confunda un
// token de plataforma con uno de tenant si algún día ambos secretos coincidieran
// por error de configuración.
export interface PlatformJwtPayload {
  sub: string;
  email: string;
  role: PlatformRole;
  scope: 'platform';
  iat?: number;
  exp?: number;
}
