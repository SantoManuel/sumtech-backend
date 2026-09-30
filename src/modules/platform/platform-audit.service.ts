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

  async findAll(options?: { limit?: number; offset?: number }) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const [items, total] = await this.auditRepo.findAndCount({
      relations: ['platformUser'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total, limit, offset };
  }
}
