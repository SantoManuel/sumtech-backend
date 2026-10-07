import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { TenantEntity } from './entities/tenant.entity';
import { TenantStatus } from './enums/tenant-status.enum';
import { QueryTenantsDto } from './dto/query-tenants.dto';
import { SuspendTenantDto } from './dto/suspend-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { PlatformAuditService } from './platform-audit.service';
import { TenantConnectionManagerService } from '../../common/tenancy/tenant-connection-manager.service';
import { UserEntity } from '../users/entities/user.entity';
import { ClientEntity } from '../clients/entities/client.entity';

import * as fs from 'fs';
import * as path from 'path';

export interface TenantHealthDto {
  tenantId: string;
  slug: string;
  dbName: string;
  status: 'HEALTHY' | 'UNREACHABLE';
  dbConnected: boolean;
  dbSizeBytes: number;
  dbSizePretty: string;
  lastMigration: {
    filename: string;
    appliedAt: Date | string;
  } | null;
  totalMigrationsApplied: number;
  totalMigrationsAvailable: number;
  pendingMigrationsCount: number;
  userCount: number;
  clientCount: number;
  errorMessage?: string;
  checkedAt: string;
}

@Injectable()
export class PlatformTenantsService {
  constructor(
    @InjectRepository(TenantEntity, 'platform')
    private readonly tenantRepo: Repository<TenantEntity>,
    private readonly auditService: PlatformAuditService,
    private readonly connectionManager: TenantConnectionManagerService,
  ) {}

  async findAll(query: QueryTenantsDto) {
    const where: any = {};

    if (query.status) {
      where.status = query.status;
    }

    const whereConditions = query.search
      ? [
          { ...where, name: ILike(`%${query.search.trim()}%`) },
          { ...where, slug: ILike(`%${query.search.trim()}%`) },
          { ...where, rnc: ILike(`%${query.search.trim()}%`) },
        ]
      : where;

    if (!query.limit) {
      return this.tenantRepo.find({
        where: whereConditions,
        relations: ['plan'],
        order: { createdAt: 'DESC' },
      });
    }

    const take = query.limit;
    const skip = query.offset ?? ((query.page ? query.page - 1 : 0) * take);

    const [items, total] = await this.tenantRepo.findAndCount({
      where: whereConditions,
      relations: ['plan'],
      order: { createdAt: 'DESC' },
      take,
      skip,
    });

    return { items, total, limit: take, offset: skip };
  }

  async update(id: string, dto: UpdateTenantDto, adminId?: string, ip?: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id }, relations: ['plan'] });

    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${id}" no encontrado`);
    }

    const changes: Record<string, any> = {};

    if (dto.name && dto.name.trim() !== tenant.name) {
      changes.oldName = tenant.name;
      changes.newName = dto.name.trim();
      tenant.name = dto.name.trim();
    }

    if (dto.rnc !== undefined && dto.rnc !== tenant.rnc) {
      changes.oldRnc = tenant.rnc;
      changes.newRnc = dto.rnc.trim() || null;
      tenant.rnc = dto.rnc.trim() || undefined;
    }

    if (dto.planId && dto.planId !== tenant.planId) {
      changes.oldPlanId = tenant.planId;
      changes.newPlanId = dto.planId;
      tenant.planId = dto.planId;
    }

    const saved = await this.tenantRepo.save(tenant);

    await this.auditService.log({
      action: 'TENANT_UPDATED',
      entity: 'Tenant',
      entityId: saved.id,
      platformUserId: adminId,
      metadata: { changes, ...dto },
      ipAddress: ip,
    });

    return saved;
  }

  async findOne(id: string) {
    const tenant = await this.tenantRepo.findOne({
      where: { id },
      relations: ['plan'],
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${id}" no encontrado`);
    }

    const health = await this.getTenantHealth(id);

    return {
      ...tenant,
      health,
      stats: {
        userCount: health.userCount,
        clientCount: health.clientCount,
        dbConnected: health.dbConnected,
        dbSizePretty: health.dbSizePretty,
        lastMigration: health.lastMigration,
      },
    };
  }

  /**
   * Diagnóstico operativo en tiempo real de la base de datos de un tenant:
   * conectividad, tamaño en disco (pg_database_size), última migración aplicada
   * y conteo de migraciones pendientes.
   */
  async getTenantHealth(id: string): Promise<TenantHealthDto> {
    const tenant = await this.tenantRepo.findOne({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${id}" no encontrado`);
    }

    const migrationsDir = path.join(__dirname, '../../database/migrations');
    const availableFiles = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
      : [];
    const totalMigrationsAvailable = availableFiles.length;

    try {
      const tenantDs = await this.connectionManager.getDataSourceForTenant(tenant);
      if (!tenantDs?.isInitialized) {
        throw new Error('No se pudo inicializar la conexión con la base de datos del tenant');
      }

      // 1. Tamaño físico de la base de datos (PostgreSQL)
      const sizeResult = await tenantDs.query(
        `SELECT pg_database_size(current_database())::bigint AS size_bytes, pg_size_pretty(pg_database_size(current_database())) AS size_pretty`,
      );
      const dbSizeBytes = parseInt(sizeResult[0]?.size_bytes || '0', 10);
      const dbSizePretty = sizeResult[0]?.size_pretty || '0 B';

      // 2. Control de versiones de esquema y migraciones
      let lastMigration: { filename: string; appliedAt: string } | null = null;
      let totalMigrationsApplied = 0;

      const tableCheck = await tenantDs.query(`
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'sec' AND table_name = 'schema_migrations'
      `);

      if (tableCheck.length > 0) {
        const migStats = await tenantDs.query(`
          SELECT "filename", "applied_at"
          FROM "sec"."schema_migrations"
          ORDER BY "applied_at" DESC, "filename" DESC
          LIMIT 1
        `);
        if (migStats.length > 0) {
          lastMigration = {
            filename: migStats[0].filename,
            appliedAt: migStats[0].applied_at,
          };
        }

        const countResult = await tenantDs.query(`SELECT COUNT(*)::int AS count FROM "sec"."schema_migrations"`);
        totalMigrationsApplied = parseInt(countResult[0]?.count || '0', 10);
      }

      const pendingMigrationsCount = Math.max(0, totalMigrationsAvailable - totalMigrationsApplied);

      // 3. Conteo de entidades activas
      const userCount = await tenantDs.getRepository(UserEntity).count();
      const clientCount = await tenantDs.getRepository(ClientEntity).count();

      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        dbName: tenant.dbName,
        status: 'HEALTHY',
        dbConnected: true,
        dbSizeBytes,
        dbSizePretty,
        lastMigration,
        totalMigrationsApplied,
        totalMigrationsAvailable,
        pendingMigrationsCount,
        userCount,
        clientCount,
        checkedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        dbName: tenant.dbName,
        status: 'UNREACHABLE',
        dbConnected: false,
        dbSizeBytes: 0,
        dbSizePretty: '0 B',
        lastMigration: null,
        totalMigrationsApplied: 0,
        totalMigrationsAvailable,
        pendingMigrationsCount: totalMigrationsAvailable,
        userCount: 0,
        clientCount: 0,
        errorMessage: err.message || 'Error de conexión con la base de datos',
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async suspend(id: string, dto?: SuspendTenantDto, adminId?: string, ip?: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${id}" no encontrado`);
    }

    if (tenant.status === TenantStatus.SUSPENDED) {
      return tenant;
    }

    tenant.status = TenantStatus.SUSPENDED;
    const saved = await this.tenantRepo.save(tenant);

    await this.auditService.log({
      action: 'TENANT_SUSPENDED',
      entity: 'Tenant',
      entityId: tenant.id,
      platformUserId: adminId,
      metadata: { slug: tenant.slug, reason: dto?.reason },
      ipAddress: ip,
    });

    return saved;
  }

  async reactivate(id: string, adminId?: string, ip?: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) {
      throw new NotFoundException(`Tenant con ID "${id}" no encontrado`);
    }

    if (tenant.status === TenantStatus.CANCELLED) {
      throw new BadRequestException('Un tenant cancelado no puede reactivarse directamente sin reprovisionamiento');
    }

    const wasTrial = tenant.status === TenantStatus.TRIAL;
    tenant.status = TenantStatus.ACTIVE;
    const saved = await this.tenantRepo.save(tenant);

    await this.auditService.log({
      action: wasTrial ? 'TENANT_ACTIVATED_FROM_TRIAL' : 'TENANT_REACTIVATED',
      entity: 'Tenant',
      entityId: tenant.id,
      platformUserId: adminId,
      metadata: { slug: tenant.slug },
      ipAddress: ip,
    });

    return saved;
  }
}
