import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID, createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { getJwtSecret, getJwtRefreshSecret } from '../../common/utils/required-env.util';
import { parseDurationToMs } from './utils/refresh-cookie.util';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';
import { TenantIteratorService } from '../../common/tenancy/tenant-iterator.service';
import { MailService } from '../mail/mail.service';

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
    private readonly tenantContext: TenantContextService,
    private readonly tenantIterator: TenantIteratorService,
    private readonly mailService: MailService,
  ) {}

  private buildAccessPayload(user: UserEntity): JwtPayload {
    return {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles ? user.roles.map((r) => r.name) : [],
      employeeId: user.employee?.id,
      clientId: user.client?.id,
      // Tenant resuelto por TenantResolutionMiddleware antes de llegar aquí
      // (login también pasa por el middleware, ya que solo /platform/* está
      // excluido) — queda embebido en el JWT para que AuthGuard pueda cruzarlo
      // contra el tenant del subdominio en cada request posterior.
      tenantId: this.tenantContext.getTenantId(),
      tenantSlug: this.tenantContext.getSlug(),
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
    await this.tenantIterator.runForEachActiveTenant('cleanup-refresh-tokens', async (tenant) => {
      const cutoff = new Date(Date.now() - REFRESH_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const result = await this.refreshTokenRepository.delete({ expiresAt: LessThan(cutoff) });
      if (result.affected) {
        this.logger.log(
          `Limpieza de refresh tokens (tenant '${tenant.slug}'): ${result.affected} fila(s) expirada(s) hace más de ${REFRESH_TOKEN_RETENTION_DAYS} días eliminadas.`,
        );
      }
    });
  }

  /**
   * Verifica credenciales de un supervisor (ADMIN o GERENTE) sin emitir un token JWT ni alterar la sesión actual.
   * Utilizado para autorización puntual de excepciones, descuentos sobre el tope o acciones restringidas.
   */
  async verifySupervisorCredentials(
    identifier: string,
    password: string,
  ): Promise<{ id: string; username: string; email: string }> {
    if (!identifier || !password) {
      throw new BadRequestException('El usuario/correo y contraseña del supervisor son requeridos');
    }

    const user = await this.usersService.findByUsernameOrEmail(identifier);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciales de supervisor inválidas o usuario inactivo');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Credenciales de supervisor inválidas');
    }

    const isSupervisor = user.roles?.some((r) => ['ADMIN', 'GERENTE'].includes(r.name));
    if (!isSupervisor) {
      throw new ForbiddenException('El usuario no posee rol de supervisor (ADMIN o GERENTE) para autorizar esta operación');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
    };
  }

  /**
   * Genera un token criptográfico de recuperación y envía un correo con el enlace
   * seguro al usuario. Aplica el principio OWASP de no enumeración (retorna siempre
   * el mismo mensaje genérico aunque el email no exista en el tenant).
   */
  async requestPasswordReset(dto: ForgotPasswordDto, origin?: string): Promise<{ message: string }> {
    const genericResponse = {
      message: 'Si el correo electrónico existe en nuestra plataforma, hemos enviado un enlace seguro para restablecer su contraseña.',
    };

    if (!dto.email) {
      return genericResponse;
    }

    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user || !user.isActive) {
      return genericResponse;
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    await this.usersService.setResetPasswordToken(user.id, tokenHash, expiresAt);

    const slug = this.tenantContext.hasContext() ? this.tenantContext.getSlug() : null;

    // Resolución dinámica de la URL base:
    // 1. Si la petición proviene de un navegador con cabecera Origin/Referer (ej. "http://isp-sabana-yegua.localhost:3000"
    //    o "https://isp-sabana-yegua.app.sumtech.com"), se toma exactamente el protocolo, subdominio y puerto del cliente.
    // 2. Fallback: se construye a partir del slug del tenant + la variable SAAS_ROOT_DOMAIN del entorno (.env).
    let baseUrl = '';
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        baseUrl = `${parsedOrigin.protocol}//${parsedOrigin.host}`;
      } catch {
        baseUrl = '';
      }
    }

    if (!baseUrl) {
      const rawRootDomain = this.configService.get<string>('SAAS_ROOT_DOMAIN') || 'localhost:3000';
      const rootDomain = rawRootDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      const isLocal = rootDomain.includes('localhost') || rootDomain.includes('127.0.0.1');
      const protocol = isLocal ? 'http' : 'https';
      baseUrl = slug ? `${protocol}://${slug}.${rootDomain}` : `${protocol}://${rootDomain}`;
    }

    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    const tenantName = slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Sumtech';
    const displayName = user.employee?.jobTitle 
      ? `${user.username}` 
      : (user.client?.name || user.username);

    await this.mailService.sendTemplatedMail({
      to: user.email,
      subject: `Recuperación de Contraseña - ${tenantName} ERP`,
      template: 'password-reset',
      context: {
        name: displayName,
        tenantName,
        resetUrl,
        expirationMinutes: 30,
      },
    });

    return genericResponse;
  }

  /**
   * Valida el token de restablecimiento (comparando su hash SHA-256), comprueba
   * que no haya expirado, hashea la nueva contraseña con bcrypt, limpia el token
   * y revoca todas las sesiones previas del usuario.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    if (!dto.token || !dto.newPassword) {
      throw new BadRequestException('El token y la nueva contraseña son requeridos');
    }

    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const user = await this.usersService.findByResetToken(tokenHash);

    if (!user || !user.resetPasswordExpiresAt || user.resetPasswordExpiresAt < new Date()) {
      throw new BadRequestException('El enlace para restablecer la contraseña es inválido o ha expirado. Por favor, solicite uno nuevo.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.usersService.updatePasswordAndClearResetToken(user.id, passwordHash);

    // Revoca todas las sesiones activas del usuario para máxima seguridad
    await this.refreshTokenRepository.update({ userId: user.id }, { revokedAt: new Date() });

    return {
      message: 'Tu contraseña ha sido restablecida exitosamente. Ya puedes iniciar sesión con tus nuevas credenciales.',
    };
  }
}
