import { SetMetadata } from '@nestjs/common';
import { PlatformRole } from '../enums/platform-role.enum';

// Clave de metadata independiente de ROLES_KEY (tenant) — deliberado, para
// que jamás se pueda leer por accidente el guard equivocado.
export const PLATFORM_ROLES_KEY = 'platformRoles';
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);
