import { 
  Injectable, 
  CanActivate, 
  ExecutionContext, 
  UnauthorizedException 
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getJwtSecret } from '../utils/required-env.util';
import { TenantContextService } from '../tenancy/tenant-context.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de autorización no proporcionado o formato inválido');
    }

    const token = authHeader.split(' ')[1];
    try {
      const payload = this.jwtService.verify(token, { secret: getJwtSecret(this.configService) });

      // Defensa en profundidad multitenant: el JWT ya trae el tenant con el
      // que se hizo login (buildAccessPayload en auth.service.ts). Si el
      // tenant resuelto por subdominio para ESTE request (TenantResolutionMiddleware,
      // que corre antes que los guards) no coincide, se rechaza — un JWT
      // robado de un tenant no debe servir contra el subdominio de otro,
      // aunque físicamente ya apuntarían a bases de datos distintas.
      if (this.tenantContext.hasContext()) {
        const currentTenantId = this.tenantContext.getTenantId();
        if (payload.tenantId && payload.tenantId !== currentTenantId) {
          throw new UnauthorizedException('El token no corresponde a este tenant');
        }
      }

      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
