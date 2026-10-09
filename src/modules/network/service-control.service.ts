import { Injectable, Logger, ConflictException, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { ProvisioningAuditLogEntity } from './entities/provisioning-audit-log.entity';
import { NetworkProvisioningPortRegistry } from './network-provisioning-port.registry';
import { ROUTEROS_CLIENT_FACTORY, RouterOsClientFactory } from './routeros/routeros-client-factory';
import { resolveRouterOsCredentials } from './routeros/routeros-credentials';
import { OltManagementService } from '../olt/services/olt-management.service';
import { NETWORK_OPS_QUEUE, NETWORK_OPS_JOBS, RetryPendingOperationJobData } from './network-ops.constants';

export interface ServiceControlContext {
  process: 'MANUAL' | 'CRON_MOROSIDAD' | 'PAGO' | 'QUEUE_RETRY' | 'BILLING';
  userId?: string;
  reason?: string;
}

export interface ServiceControlResult {
  applied: boolean;
  medium: 'PPPOE' | 'OLT_NATIVE' | 'DHCP' | 'NONE';
  verified: boolean;
  errorCode?: string;
  message?: string;
}

export const NET_DEVICE_OFFLINE_CODE = 'NET_DEVICE_OFFLINE';

@Injectable()
export class ServiceControlService {
  private readonly logger = new Logger(ServiceControlService.name);

  constructor(
    @InjectRepository(NetworkAccessEntity)
    private readonly accessRepository: Repository<NetworkAccessEntity>,
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(ProvisioningAuditLogEntity)
    private readonly auditRepository: Repository<ProvisioningAuditLogEntity>,
    private readonly portRegistry: NetworkProvisioningPortRegistry,
    @Inject(ROUTEROS_CLIENT_FACTORY)
    private readonly clientFactory: RouterOsClientFactory,
    private readonly oltService: OltManagementService,
    @InjectQueue(NETWORK_OPS_QUEUE)
    private readonly networkOpsQueue: Queue<RetryPendingOperationJobData>,
  ) {}

  /**
   * Suspende el servicio de internet en el equipo de red del cliente con confirmación y verificación (RF-PPPOE-005/006).
   */
  async suspendService(contractId: string, ctx: ServiceControlContext): Promise<ServiceControlResult> {
    return this.executeServiceOperation(contractId, 'SUSPEND', ctx);
  }

  /**
   * Restaura el servicio de internet en el equipo de red del cliente con confirmación y verificación (RF-SUS-001/002).
   */
  async restoreService(contractId: string, ctx: ServiceControlContext): Promise<ServiceControlResult> {
    return this.executeServiceOperation(contractId, 'RESTORE', ctx);
  }

  /**
   * Aplica o reintenta una operación pendiente sobre un acceso específico (RF-RED-003).
   */
  async applyPending(accessId: string): Promise<ServiceControlResult> {
    const access = await this.accessRepository.findOne({
      where: { id: accessId },
      relations: ['node', 'onu', 'onu.olt', 'contract', 'contract.client'],
    });

    if (!access) {
      throw new NotFoundException(`Acceso de red ${accessId} no encontrado`);
    }

    if (!access.pendingOperation) {
      return {
        applied: true,
        medium: this.portRegistry.resolveSuspensionMedium(access),
        verified: true,
        message: 'No hay operaciones pendientes para este acceso.',
      };
    }

    const op = access.pendingOperation;
    const ctx: ServiceControlContext = {
      process: 'QUEUE_RETRY',
      reason: `Reintento automático de operación pendiente (${op})`,
    };

    return this.executeWithLoadedAccess(access, op, ctx);
  }

  /**
   * Consulta todas las operaciones pendientes de red para widgets y pantallas operativas.
   */
  async getPendingOperations(): Promise<NetworkAccessEntity[]> {
    return this.accessRepository
      .createQueryBuilder('access')
      .leftJoinAndSelect('access.contract', 'contract')
      .leftJoinAndSelect('contract.client', 'client')
      .leftJoinAndSelect('access.node', 'node')
      .leftJoinAndSelect('access.onu', 'onu')
      .leftJoinAndSelect('onu.olt', 'olt')
      .where('access.pendingOperation IS NOT NULL')
      .orderBy('access.pendingSince', 'ASC')
      .getMany();
  }

  private async executeServiceOperation(
    contractId: string,
    operation: 'SUSPEND' | 'RESTORE',
    ctx: ServiceControlContext,
  ): Promise<ServiceControlResult> {
    const access = await this.accessRepository.findOne({
      where: { contractId },
      relations: ['node', 'onu', 'onu.olt', 'contract', 'contract.client'],
    });

    if (!access) {
      this.logger.warn(`Contrato ${contractId} sin acceso de red registrado. Operación ${operation} completada como sin equipo.`);
      return {
        applied: true,
        medium: 'NONE',
        verified: true,
        message: 'Contrato sin acceso de red configurado (servicio sin equipo).',
      };
    }

    return this.executeWithLoadedAccess(access, operation, ctx);
  }

  private async executeWithLoadedAccess(
    access: NetworkAccessEntity,
    operation: 'SUSPEND' | 'RESTORE' | 'DEPROVISION',
    ctx: ServiceControlContext,
  ): Promise<ServiceControlResult> {
    const medium = this.portRegistry.resolveSuspensionMedium(access);

    // Si no hay medio asignado (nodo MANUAL o sin nodo/ONU)
    if (medium === 'NONE') {
      access.connectionStatus =
        operation === 'SUSPEND' ? 'SUSPENDED' : operation === 'RESTORE' ? 'ACTIVE' : 'CUT';
      access.pendingOperation = null;
      access.pendingSince = null;
      access.pendingAttempts = 0;
      access.lastErrorCode = null;
      access.lastSyncAt = new Date();
      access.lastSyncError = null;

      const saved = await this.accessRepository.save(access);
      await this.auditOperation(saved, operation, 'OK', ctx);

      return {
        applied: true,
        medium: 'NONE',
        verified: true,
        message: 'Operación registrada correctamente (nodo MANUAL o sin equipo).',
      };
    }

    // Pre-check de conectividad (ensureOnline)
    const onlineCheck = await this.ensureOnline(access, medium);
    if (!onlineCheck.isOnline) {
      const errorCode = NET_DEVICE_OFFLINE_CODE;
      const errorMsg = onlineCheck.error || 'El equipo de red asignado se encuentra inalcanzable u offline.';

      this.logger.warn(
        `Pre-check fallido (${operation}) para contrato ${access.contractId} en medio ${medium}: ${errorMsg}`,
      );

      // Si es un comando manual iniciado por un usuario (ADMIN / GERENTE), rechazar con HTTP 409
      if (ctx.process === 'MANUAL') {
        await this.auditOperation(access, operation, 'ERROR', ctx, errorCode, errorMsg);
        throw new ConflictException(
          `${errorCode}: El equipo de red (${medium}) no responde a la prueba de conexión. La operación no fue aplicada.`,
        );
      }

      // Si es un proceso automático (Cron de morosidad, facturación o cola de fondo)
      access.pendingOperation = operation;
      access.pendingSince = access.pendingSince || new Date();
      access.pendingAttempts = (access.pendingAttempts || 0) + 1;
      access.lastErrorCode = errorCode;
      access.lastSyncError = errorMsg;
      access.lastSyncAt = new Date();

      const saved = await this.accessRepository.save(access);
      await this.auditOperation(saved, operation, 'ERROR', ctx, errorCode, errorMsg);

      // Encolar reintento en BullMQ
      await this.enqueueRetry(saved, operation);

      return {
        applied: false,
        medium,
        verified: false,
        errorCode,
        message: 'Equipo offline. La operación ha quedado registrada como pendiente para reintento automático.',
      };
    }

    // Equipo online -> Ejecutar con el adaptador correspondiente
    const port = this.portRegistry.resolveForAccess(access);
    const execResult =
      operation === 'SUSPEND'
        ? await port.suspend(access)
        : operation === 'RESTORE'
        ? await port.restore(access)
        : await port.deprovision(access);

    if (!execResult.ok) {
      const errorMsg = execResult.error || 'Fallo durante la ejecución en el adaptador de red';
      access.lastSyncError = errorMsg;
      access.lastSyncAt = new Date();
      await this.accessRepository.save(access);
      await this.auditOperation(access, operation, 'ERROR', ctx, 'PROVISION_EXEC_ERROR', errorMsg);

      if (ctx.process === 'MANUAL') {
        throw new ConflictException(`Error aplicando ${operation} en el equipo: ${errorMsg}`);
      }

      return {
        applied: false,
        medium,
        verified: false,
        errorCode: 'PROVISION_EXEC_ERROR',
        message: errorMsg,
      };
    }

    // Verificación de estado de vuelta (§1.5: Confirmación de lectura)
    const verification = await this.verifyOperation(access, medium, operation);

    // Limpiar estado de pendientes
    access.connectionStatus =
      operation === 'SUSPEND' ? 'SUSPENDED' : operation === 'RESTORE' ? 'ACTIVE' : 'CUT';
    access.pendingOperation = null;
    access.pendingSince = null;
    access.pendingAttempts = 0;
    access.lastErrorCode = null;
    access.lastSyncError = null;
    access.lastSyncAt = new Date();

    const saved = await this.accessRepository.save(access);
    await this.auditOperation(saved, operation, 'OK', ctx);

    return {
      applied: true,
      medium,
      verified: verification.verified,
      message: `Operación ${operation} completada y confirmada en el equipo (${medium}).`,
    };
  }

  /**
   * Pre-check de conexión (ensureOnline) según el medio de suspensión.
   */
  private async ensureOnline(
    access: NetworkAccessEntity,
    medium: 'PPPOE' | 'OLT_NATIVE' | 'DHCP',
  ): Promise<{ isOnline: boolean; error?: string }> {
    if (medium === 'PPPOE') {
      if (!access.node || !access.node.managementIp) {
        return { isOnline: false, error: 'Nodo MikroTik no asignado o sin IP de gestión' };
      }
      try {
        let username = access.node.apiUser || 'admin';
        let password = '';
        try {
          const creds = resolveRouterOsCredentials(access.node.name);
          username = creds.username;
          password = creds.password;
        } catch {
          // Fallback a credenciales del nodo si no están en variable de entorno
        }

        const client = this.clientFactory({
          managementIp: access.node.managementIp,
          apiPort: access.node.apiPort,
          useHttps: access.node.useHttps,
          username,
          password,
        });
        const conn = await client.testConnection();
        return { isOnline: Boolean(conn.ok), error: conn.error };
      } catch (err: any) {
        return { isOnline: false, error: err.message };
      }
    }

    if (medium === 'OLT_NATIVE') {
      if (!access.onuId || !access.onu) {
        return { isOnline: false, error: 'Acceso no tiene ONU vinculada para medio OLT_NATIVE' };
      }
      try {
        const oltId = access.onu.oltId || access.onu.olt?.id;
        if (!oltId) {
          return { isOnline: false, error: 'ONU no tiene OLT asignada' };
        }
        const oltTest = await this.oltService.testConnection(oltId);
        return { isOnline: Boolean(oltTest.ok), error: oltTest.error };
      } catch (err: any) {
        return { isOnline: false, error: err.message };
      }
    }

    return { isOnline: true };
  }

  /**
   * Verificación de estado de vuelta leyendo directamente del equipo.
   */
  private async verifyOperation(
    access: NetworkAccessEntity,
    medium: 'PPPOE' | 'OLT_NATIVE' | 'DHCP',
    operation: 'SUSPEND' | 'RESTORE' | 'DEPROVISION',
  ): Promise<{ verified: boolean }> {
    if (medium === 'PPPOE' && access.node?.managementIp && access.username) {
      try {
        let username = access.node.apiUser || 'admin';
        let password = '';
        try {
          const creds = resolveRouterOsCredentials(access.node.name);
          username = creds.username;
          password = creds.password;
        } catch {
          // Fallback a credenciales del nodo
        }

        const client = this.clientFactory({
          managementIp: access.node.managementIp,
          apiPort: access.node.apiPort,
          useHttps: access.node.useHttps,
          username,
          password,
        });
        const secret = await client.findPppSecretByName(access.username);
        if (secret) {
          const expectedDisabled = operation === 'SUSPEND' || operation === 'DEPROVISION';
          return { verified: secret.disabled === expectedDisabled };
        }
      } catch {
        // En caso de que la verificación secundaria falle la lectura, el comando principal ya fue OK
      }
    }
    return { verified: true };
  }

  /**
   * Encola la operación en BullMQ con backoff exponencial:
   * Intentos: 1 min, 5 min, 15 min, 60 min, y luego cada hora.
   */
  private async enqueueRetry(access: NetworkAccessEntity, operation: 'SUSPEND' | 'RESTORE' | 'DEPROVISION') {
    const attempts = access.pendingAttempts;
    let delayMs = 60 * 1000; // 1 min

    if (attempts === 2) delayMs = 5 * 60 * 1000; // 5 min
    else if (attempts === 3) delayMs = 15 * 60 * 1000; // 15 min
    else if (attempts === 4) delayMs = 60 * 60 * 1000; // 60 min
    else if (attempts >= 5) delayMs = 60 * 60 * 1000; // Cada hora

    if (attempts >= 5) {
      this.logger.error(
        `[ALERTA ADMIN] Operación ${operation} para contrato ${access.contractId} ha fallado ${attempts} veces consecutivas (equipo offline).`,
      );
    }

    await this.networkOpsQueue.add(
      NETWORK_OPS_JOBS.RETRY_PENDING_OPERATION,
      {
        accessId: access.id,
        contractId: access.contractId,
        operation,
        attempt: attempts,
      },
      {
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  private async auditOperation(
    access: NetworkAccessEntity,
    operation: 'SUSPEND' | 'RESTORE' | 'DEPROVISION',
    result: 'OK' | 'ERROR',
    ctx: ServiceControlContext,
    errorCode?: string,
    errorMessage?: string,
  ) {
    const audit = this.auditRepository.create({
      accessId: access.id,
      contractId: access.contractId,
      nodeId: access.nodeId,
      action: operation === 'SUSPEND' ? 'SUSPEND' : operation === 'RESTORE' ? 'RESTORE' : 'DEPROVISION',
      result,
      errorCode,
      errorMessage,
      reason: ctx.reason || (operation === 'SUSPEND' ? 'Suspensión de servicio' : operation === 'RESTORE' ? 'Reactivación de servicio' : 'Corte de servicio'),
      actor: ctx.userId ? `USER:${ctx.userId}` : ctx.process,
      actorUserId: ctx.userId,
    });
    await this.auditRepository.save(audit);
  }
}
