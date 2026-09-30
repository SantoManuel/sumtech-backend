import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PlatformUserEntity } from './entities/platform-user.entity';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformJwtPayload } from './interfaces/platform-jwt-payload.interface';
import { getPlatformJwtSecret } from '../../common/utils/required-env.util';

// Deliberadamente simple para la Fase 0: solo access token (sin refresh
// token/cookie rotation, a diferencia de AuthService de tenant) — el panel
// SuperAdmin de la Fase 6 puede pedir ampliar esto si hace falta.
@Injectable()
export class PlatformAuthService {
  constructor(
    @InjectRepository(PlatformUserEntity, 'platform')
    private readonly platformUserRepository: Repository<PlatformUserEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: PlatformLoginDto) {
    const platformUser = await this.platformUserRepository.findOne({
      where: { email: dto.email },
      select: ['id', 'email', 'passwordHash', 'role', 'isActive'],
    });

    if (!platformUser || !platformUser.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isMatch = await bcrypt.compare(dto.password, platformUser.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload: PlatformJwtPayload = {
      sub: platformUser.id,
      email: platformUser.email,
      role: platformUser.role,
      scope: 'platform',
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: getPlatformJwtSecret(this.configService),
      expiresIn: this.configService.get<string>('PLATFORM_JWT_EXPIRATION_TIME') || '8h',
    });

    return {
      accessToken,
      user: {
        id: platformUser.id,
        email: platformUser.email,
        role: platformUser.role,
      },
    };
  }

  async findById(id: string): Promise<PlatformUserEntity | null> {
    return this.platformUserRepository.findOneBy({ id });
  }
}
