import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID, createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { getJwtSecret, getJwtRefreshSecret } from '../../common/utils/required-env.util';
import { parseDurationToMs } from './utils/refresh-cookie.util';

const REFRESH_TOKEN_RETENTION_DAYS = 30;

export interface RefreshTokenMetadata {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
  ) {}

  private buildAccessPayload(user: UserEntity): JwtPayload {
    return {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles ? user.roles.map((r) => r.name) : [],
      employeeId: user.employee?.id,
      clientId: user.client?.id,
    };
  }

  private signAccessToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: getJwtSecret(this.configService),
      expiresIn: this.configService.get<string>('JWT_EXPIRATION_TIME') || '15m',
    });
  }

  /**
   * Firma un nuevo refresh token JWT (con jti/familyId propios) y persiste su
   * hash SHA-256 en sec.refresh_tokens — el valor en claro nunca se guarda.
   */
  private async issueRefreshToken(
    userId: string,
    payload: JwtPayload,
    familyId: string,
    metadata?: RefreshTokenMetadata,
  ): Promise<{ rawToken: string; expiresAt: Date }> {
    const jti = randomUUID();
    const expirationConfig = this.configService.get<string>('JWT_REFRESH_EXPIRATION_TIME') || '7d';

    const rawToken = this.jwtService.sign(
      { ...payload, jti, familyId },
      {
        secret: getJwtRefreshSecret(this.configService),
        expiresIn: expirationConfig,
      },
    );

    const expiresAt = new Date(Date.now() + parseDurationToMs(expirationConfig));
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        userId,
        familyId,
        tokenHash,
        expiresAt,
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
      }),
    );

    return { rawToken, expiresAt };
  }

  async login(dto: LoginDto, metadata?: RefreshTokenMetadata) {
    const userIdentifier = dto.identifier || dto.username;
    if (!userIdentifier) {
      throw new BadRequestException('El usuario o correo es requerido');
    }

    const user = await this.usersService.findByUsernameOrEmail(userIdentifier);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload = this.buildAccessPayload(user);
    const accessToken = this.signAccessToken(payload);

    const familyId = randomUUID();
    const { rawToken: refreshTokenRaw } = await this.issueRefreshToken(user.id, payload, familyId, metadata);

    return {
      accessToken,
      refreshTokenRaw,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: payload.roles,
        employee: user.employee ? {
          id: user.employee.id,
          cedula: user.employee.cedula,
          jobTitle: user.employee.jobTitle,
          photoUrl: user.employee.photoUrl,
        } : undefined,
        client: user.client ? {
          id: user.client.id,
          name: user.client.name,
          docNumber: user.client.docNumber,
          email: user.client.email,
          phone: user.client.phone,
        } : undefined,
      },
    };
  }

  /**
   * Rota el refresh token: revoca el actual y emite uno nuevo con el mismo
   * familyId. Si el token presentado ya estaba revocado (reuso), se interpreta
   * como robo y se revoca TODA la familia, forzando reautenticación completa.
   */
  async refreshToken(rawRefreshToken: string, metadata?: RefreshTokenMetadata) {
    let decoded: JwtPayload & { jti: string; familyId: string };
    try {
      decoded = this.jwtService.verify(rawRefreshToken, { secret: getJwtRefreshSecret(this.configService) });
    } catch {
      throw new UnauthorizedException('Token de refresco inválido o expirado');
    }

    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    const storedToken = await this.refreshTokenRepository.findOne({ where: { tokenHash } });

    if (!storedToken) {
      throw new UnauthorizedException('Token de refresco inválido o expirado');
    }

    if (storedToken.revokedAt) {
      this.logger.warn(
        `Reuso de refresh token detectado para userId=${storedToken.userId}, familyId=${storedToken.familyId}. Revocando toda la familia.`,
      );
      await this.refreshTokenRepository.update({ familyId: storedToken.familyId }, { revokedAt: new Date() });
      throw new UnauthorizedException('Sesión inválida — se detectó reuso de un token ya rotado. Vuelve a iniciar sesión.');
    }

    const user = await this.usersService.findById(decoded.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Sesión no válida o expirada');
    }

    const payload = this.buildAccessPayload(user);
    const accessToken = this.signAccessToken(payload);

    const { rawToken: newRefreshTokenRaw } = await this.issueRefreshToken(
      user.id,
      payload,
      storedToken.familyId,
      metadata,
    );
    const newTokenHash = createHash('sha256').update(newRefreshTokenRaw).digest('hex');

    storedToken.revokedAt = new Date();
    storedToken.replacedByTokenHash = newTokenHash;
    await this.refreshTokenRepository.save(storedToken);

    return { accessToken, refreshTokenRaw: newRefreshTokenRaw };
  }

  /**
   * Revoca el refresh token de la sesión actual (logout de "este dispositivo").
   * Idempotente: si el token ya no existe o es inválido, no lanza — el
   * resultado deseado ("sesión cerrada") ya se cumple de todas formas.
   */
  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    await this.refreshTokenRepository.update({ tokenHash }, { revokedAt: new Date() });
  }

  /**
   * Purga refresh tokens vencidos hace más de REFRESH_TOKEN_RETENTION_DAYS —
   * se conservan un tiempo tras expirar por si hace falta auditar un reuso.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupExpiredRefreshTokens(): Promise<void> {
    const cutoff = new Date(Date.now() - REFRESH_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.refreshTokenRepository.delete({ expiresAt: LessThan(cutoff) });
    if (result.affected) {
      this.logger.log(`Limpieza de refresh tokens: ${result.affected} fila(s) expirada(s) hace más de ${REFRESH_TOKEN_RETENTION_DAYS} días eliminadas.`);
    }
  }
}
