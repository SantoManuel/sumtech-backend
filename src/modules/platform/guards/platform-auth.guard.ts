import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getPlatformJwtSecret } from '../../../common/utils/required-env.util';
import { PlatformJwtPayload } from '../interfaces/platform-jwt-payload.interface';

// Mismo patrón hand-rolled que src/common/guards/auth.guard.ts (este código no
// usa Passport), pero como clase completamente separada: verifica contra
// PLATFORM_JWT_SECRET (nunca JWT_SECRET de tenants) y exige el claim
// `scope: 'platform'` explícitamente — así un JWT de tenant jamás es válido
// aquí y viceversa, incluso si algún día los secretos coincidieran por error.
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de autorización no proporcionado o formato inválido');
    }

    const token = authHeader.split(' ')[1];
    try {
      const payload = this.jwtService.verify<PlatformJwtPayload>(token, {
        secret: getPlatformJwtSecret(this.configService),
      });
      if (payload.scope !== 'platform') {
        throw new UnauthorizedException('Token inválido para el scope de plataforma');
      }
      request.platformUser = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
