import { Injectable, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ReachabilityResolver } from './reachability-resolver.service';
import { RouterOsRestTransport } from '../transports/routeros-rest.transport';
import { RouterOsBinaryTransport } from '../transports/routeros-binary.transport';
import { RouterOsSshTransport } from '../transports/routeros-ssh.transport';
import { DeviceOperationLogger } from './device-operation-logger.service';
import { decryptCredential } from '../utils/crypto.util';
import { classifyDeviceError } from '../utils/device-error-classifier.util';
import { NetErrorCode } from '../enums/net-error-code.enum';
import { TransportConnectionTarget } from '../interfaces/routeros-transport.interface';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { TenantIteratorService } from '../../../common/tenancy/tenant-iterator.service';

@Injectable()
export class DeviceHealthService {
  private readonly logger = new Logger(DeviceHealthService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly tenantIterator: TenantIteratorService,
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly restTransport: RouterOsRestTransport,
    private readonly binaryTransport: RouterOsBinaryTransport,
    private readonly sshTransport: RouterOsSshTransport,
    private readonly operationLogger: DeviceOperationLogger,
  ) {}

  // IMPORTANTE: antes este servicio inyectaba el DataSource por defecto
  // (ver [[sumtech_tenant_datasource_gap]]) — en una plataforma multi-tenant
  // eso apunta a una base legacy ajena al tenant real, nunca a la BD real del
  // tenant que hizo la petición. Se resuelve vía TenantContextService, que
  // exige estar dentro de un contexto de tenant ya establecido (un request
  // HTTP que pasó por TenantResolutionMiddleware, o un cron envuelto en
  // TenantIteratorService.runForEachActiveTenant — ver handleScheduledHealthChecks).
  private getNodeRepository(): Repository<NetworkNodeEntity> {
    return this.tenantContext.getDataSource().getRepository(NetworkNodeEntity);
  }

  /**
   * Ejecuta el chequeo de salud para un nodo individual.
   */
  async checkNodeHealth(nodeId: string, actorUserId?: string): Promise<{ success: boolean; node: NetworkNodeEntity }> {
    const repo = this.getNodeRepository();
    const node = await repo.findOne({ where: { id: nodeId } });
    if (!node) {
      throw new Error(`Nodo no encontrado: ${nodeId}`);
    }

    try {
      const resolved = await this.reachabilityResolver.resolveEndpoint(node);
      const password = node.apiPasswordEnc
        ? decryptCredential(node.apiPasswordEnc)
        : process.env.ROUTEROS_PASSWORD || '';
      const username = node.apiUser || process.env.ROUTEROS_USER || 'admin';

      const target: TransportConnectionTarget = {
        host: resolved.host,
        port: resolved.port,
        useHttps: resolved.useHttps,
        username,
        password,
        timeoutMs: 5000,
      };

      const transport =
        node.transportType === 'ROUTEROS_API'
          ? this.binaryTransport
          : node.transportType === 'SSH'
          ? this.sshTransport
          : this.restTransport;

      const metrics = await transport.getSystemResource(target);

      node.status = 'ACTIVE';
      node.lastSyncStatus = 'OK';
      node.lastSyncAt = new Date();
      node.lastHeartbeatAt = new Date();
      node.cpuUsage = metrics.cpuLoad;
      node.memoryFreeBytes = metrics.freeMemoryBytes;
      node.memoryTotalBytes = metrics.totalMemoryBytes;
      node.diskFreeBytes = metrics.freeHddBytes;
      node.diskTotalBytes = metrics.totalHddBytes;
      node.uptimeSeconds = metrics.uptimeSeconds;
      node.temperatureCelsius = metrics.temperature;
      node.voltage = metrics.voltage;
      if (metrics.version) {
        node.routerosVersion = metrics.version;
      }
      node.lastErrorCode = undefined;
      node.lastErrorMessage = undefined;

      const saved = await repo.save(node);

      await this.operationLogger.logEvent({
        nodeId: node.id,
        eventType: 'HEALTH_CHECK',
        status: 'SUCCESS',
        message: `Health check exitoso. CPU: ${metrics.cpuLoad}%, Uptime: ${metrics.uptimeSeconds}s, Versión: ${metrics.version}`,
        ipAddress: resolved.host,
        actorUserId,
        rawDetails: {
          cpuLoad: metrics.cpuLoad,
          freeMemory: metrics.freeMemoryBytes,
          uptime: metrics.uptimeSeconds,
        },
      });

      return { success: true, node: saved };
    } catch (err: any) {
      const classification = classifyDeviceError(err);
      this.logger.warn(`Health check fallido para nodo ${node.name}: [${classification.code}] ${classification.message}`);

      if (classification.code === NetErrorCode.NET_AUTH_INVALID) {
        node.status = 'ERROR_AUTH';
      } else {
        node.status = 'UNREACHABLE';
      }

      node.lastSyncStatus = 'ERROR';
      node.lastSyncAt = new Date();
      node.lastErrorCode = classification.code;
      node.lastErrorMessage = classification.message;

      const saved = await repo.save(node);

      await this.operationLogger.logEvent({
        nodeId: node.id,
        eventType: 'HEALTH_CHECK',
        status: 'FAILURE',
        errorCode: classification.code,
        message: classification.message,
        actorUserId,
        rawDetails: {
          rawError: err.message,
          stack: err.stack,
        },
      });

      return { success: false, node: saved };
    }
  }

  /**
   * Sondeo automático periódico de salud de nodos cada 5 minutos.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleScheduledHealthChecks() {
    await this.tenantIterator.runForEachActiveTenant('device-health-check', async () => {
      const repo = this.getNodeRepository();
      const nodes = await repo.find({
        where: {
          isActive: true,
          provisioningMode: 'ROUTEROS',
        },
      });

      if (nodes.length === 0) return;

      this.logger.log(`Iniciando sondeo de salud periódico para ${nodes.length} nodo(s)...`);
      for (const node of nodes) {
        await this.checkNodeHealth(node.id);
      }
    });
  }
}
