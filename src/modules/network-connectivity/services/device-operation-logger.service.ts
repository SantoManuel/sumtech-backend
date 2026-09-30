import { Injectable, Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { DeviceLogEntity, DeviceLogStatus } from '../../network/entities/device-log.entity';

export interface RecordDeviceLogParams {
  nodeId: string;
  eventType: 'HEARTBEAT' | 'HEALTH_CHECK' | 'CONNECT' | 'DISCONNECT' | 'PROVISION' | 'COMMAND' | 'ERROR';
  status: DeviceLogStatus;
  errorCode?: string;
  message: string;
  rawDetails?: Record<string, unknown>;
  ipAddress?: string;
  actorUserId?: string;
}

export interface DeviceLogFilter {
  nodeId?: string;
  eventType?: string;
  status?: DeviceLogStatus;
  page?: number;
  limit?: number;
}

@Injectable()
export class DeviceOperationLogger {
  private readonly logger = new Logger(DeviceOperationLogger.name);

  constructor(private readonly dataSource: DataSource) {}

  private getRepository(): Repository<DeviceLogEntity> {
    return this.dataSource.getRepository(DeviceLogEntity);
  }

  /**
   * Guarda un nuevo evento de log para un dispositivo de red.
   */
  async logEvent(params: RecordDeviceLogParams): Promise<DeviceLogEntity> {
    try {
      const repo = this.getRepository();
      const entity = repo.create({
        nodeId: params.nodeId,
        eventType: params.eventType,
        status: params.status,
        errorCode: params.errorCode,
        message: params.message,
        rawDetails: params.rawDetails,
        ipAddress: params.ipAddress,
        actorUserId: params.actorUserId,
      });

      return await repo.save(entity);
    } catch (err: any) {
      this.logger.error(`Error guardando log de dispositivo (${params.nodeId}): ${err.message}`);
      // No propagar fallo para que los logs no rompan la operación principal
      return null as any;
    }
  }

  /**
   * Obtiene logs de un dispositivo con filtros y paginación.
   */
  async getLogs(filter: DeviceLogFilter): Promise<{ data: DeviceLogEntity[]; total: number }> {
    const repo = this.getRepository();
    const query = repo.createQueryBuilder('log');

    if (filter.nodeId) {
      query.andWhere('log.nodeId = :nodeId', { nodeId: filter.nodeId });
    }
    if (filter.eventType) {
      query.andWhere('log.eventType = :eventType', { eventType: filter.eventType });
    }
    if (filter.status) {
      query.andWhere('log.status = :status', { status: filter.status });
    }

    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, 100) : 20;

    query.orderBy('log.createdAt', 'DESC');
    query.skip((page - 1) * limit);
    query.take(limit);

    const [data, total] = await query.getManyAndCount();
    return { data, total };
  }
}
