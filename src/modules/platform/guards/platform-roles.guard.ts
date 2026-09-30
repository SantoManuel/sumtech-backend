import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY } from '../decorators/platform-roles.decorator';
import { PlatformRole } from '../enums/platform-role.enum';

@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<PlatformRole[]>(PLATFORM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { platformUser } = context.switchToHttp().getRequest();
    if (!platformUser || !platformUser.role) {
      throw new ForbiddenException('No tienes permisos para realizar esta acción');
    }

    if (!requiredRoles.includes(platformUser.role)) {
      throw new ForbiddenException(`Acceso denegado. Se requiere uno de los siguientes roles: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
