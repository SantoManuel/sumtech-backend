import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SupportAccessSessionEntity } from './entities/support-access-session.entity';
import { TenantEntity } from './entities/tenant.entity';
import { TenantStatus } from './enums/tenant-status.enum';
import { StartSupportSessionDto } from './dto/start-support-session.dto';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformJwtPayload } from './interfaces/platform-jwt-payload.interface';

@Injectable()
export class SupportAccessService {
  constructor(
    @InjectRepository(SupportAccessSessionEntity, 'platform')
    private readonly sessionRepo: Repository<SupportAccessSessionEntity>,
    @InjectRepository(TenantEntity, 'platform')
    private readonly tenantRepo: Repository<TenantEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: PlatformAuditService,
  ) {}

  async startSession(dto: StartSupportSessionDto, admin: PlatformJwtPayload, ip?: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: dto.tenantId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${dto.tenantId}" no encontrado`);
    }

    if (tenant.status === TenantStatus.CANCELLED) {
      throw new BadRequestException('No es posible acceder a un tenant con estado CANCELLED.');
    }

    // 1. Registrar sesión en base de datos de plataforma
    const session = this.sessionRepo.create({
      adminId: admin.sub,
      tenantId: tenant.id,
      reason: dto.reason.trim(),
      startedAt: new Date(),
      ip,
    });
    const savedSession = await this.sessionRepo.save(session);

    // 2. Emitir JWT de corta duración (1 hora) con el contexto auditado
    const secret = this.configService.get<string>('JWT_SECRET', 'sumtech-jwt-secret');
    const tenantPayload = {
      sub: admin.sub,
      email: admin.email,
      username: `soporte.${admin.email.split('@')[0]}`,
      roles: ['ADMIN'], // Rol administrativo dentro del ERP para inspección
      isSupportSession: true,
      supportSessionId: savedSession.id,
      supportReason: dto.reason.trim(),
      tenantSlug: tenant.slug,
      adminEmail: admin.email,
    };

    const accessToken = await this.jwtService.signAsync(tenantPayload, {
      secret,
      expiresIn: '1h',
    });

    // 3. Registrar auditoría de plataforma
    await this.auditService.log({
      action: 'SUPPORT_SESSION_STARTED',
      entity: 'SupportAccessSession',
      entityId: savedSession.id,
      platformUserId: admin.sub,
      metadata: {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        reason: dto.reason.trim(),
      },
      ipAddress: ip,
    });

    return {
      session: savedSession,
      accessToken,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      erpUrl: `http://${tenant.slug}.localhost:3000/dashboard`,
    };
  }

  async endSession(id: string, adminId?: string, ip?: string) {
    const session = await this.sessionRepo.findOne({
      where: { id },
      relations: ['tenant'],
    });

    if (!session) {
      throw new NotFoundException(`Sesión de soporte "${id}" no encontrada`);
    }

    if (session.endedAt) {
      return { message: 'La sesión ya había sido finalizada previamente.', session };
    }

    session.endedAt = new Date();
    const updated = await this.sessionRepo.save(session);

    await this.auditService.log({
      action: 'SUPPORT_SESSION_ENDED',
      entity: 'SupportAccessSession',
      entityId: session.id,
      platformUserId: adminId,
      metadata: {
        tenantId: session.tenantId,
        tenantSlug: session.tenant?.slug,
      },
      ipAddress: ip,
    });

    return {
      message: 'Sesión de soporte finalizada con éxito.',
      session: updated,
    };
  }

  async findAll() {
    return this.sessionRepo.find({
      relations: ['admin', 'tenant'],
      order: { startedAt: 'DESC' },
      take: 100,
    });
  }
}
