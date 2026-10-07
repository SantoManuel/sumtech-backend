import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformAuditLogEntity } from './entities/platform-audit-log.entity';

export interface CreateAuditLogParams {
  action: string;
  entity?: string;
  entityId?: string;
  platformUserId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export interface FindAuditLogsOptions {
  search?: string;
  action?: string;
  platformUserId?: string;
  entity?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  page?: number;
}

@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger(PlatformAuditService.name);

  constructor(
    @InjectRepository(PlatformAuditLogEntity, 'platform')
    private readonly auditRepo: Repository<PlatformAuditLogEntity>,
  ) {}

  async log(params: CreateAuditLogParams): Promise<PlatformAuditLogEntity> {
    try {
      const record = this.auditRepo.create({
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        platformUserId: params.platformUserId,
        metadata: params.metadata,
        ipAddress: params.ipAddress,
      });
      return await this.auditRepo.save(record);
    } catch (err: any) {
      this.logger.error(`Error guardando log de auditoría (${params.action}): ${err?.message}`, err?.stack);
      // No re-lanzamos para no interrumpir la transacción principal, pero dejamos trace en logs
      return null as any;
    }
  }

  async findAll(options?: FindAuditLogsOptions) {
    const take = options?.limit ?? 50;
    const skip = options?.offset ?? ((options?.page ? options.page - 1 : 0) * take);

    const qb = this.auditRepo.createQueryBuilder('log')
      .leftJoinAndSelect('log.platformUser', 'user')
      .orderBy('log.createdAt', 'DESC');

    if (options?.search?.trim()) {
      qb.andWhere(
        '(log.action ILIKE :search OR log.entity ILIKE :search OR log.entityId ILIKE :search OR user.email ILIKE :search)',
        { search: `%${options.search.trim()}%` },
      );
    }

    if (options?.action?.trim() && options.action !== 'ALL') {
      qb.andWhere('log.action ILIKE :action', { action: `%${options.action.trim()}%` });
    }

    if (options?.platformUserId?.trim() && options.platformUserId !== 'ALL') {
      qb.andWhere('log.platformUserId = :platformUserId', { platformUserId: options.platformUserId.trim() });
    }

    if (options?.entity?.trim() && options.entity !== 'ALL') {
      qb.andWhere('log.entity = :entity', { entity: options.entity.trim() });
    }

    if (options?.startDate?.trim()) {
      qb.andWhere('log.createdAt >= :startDate', { startDate: new Date(options.startDate.trim()) });
    }

    if (options?.endDate?.trim()) {
      const end = new Date(options.endDate.trim());
      end.setHours(23, 59, 59, 999);
      qb.andWhere('log.createdAt <= :endDate', { endDate: end });
    }

    qb.take(take).skip(skip);

    const [items, total] = await qb.getManyAndCount();

    return { items, total, limit: take, offset: skip };
  }
}
