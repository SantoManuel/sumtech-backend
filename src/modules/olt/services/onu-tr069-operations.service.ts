import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { Repository, In, LessThanOrEqual } from 'typeorm';
import { createHmac, randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { OnuTr069OperationEntity } from '../entities/onu-tr069-operation.entity';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { OnuManagementService } from './onu-management.service';
import { OnuWanProvisioningService } from './onu-wan-provisioning.service';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { TenantIteratorService } from '../../../common/tenancy/tenant-iterator.service';
import { encryptSecret, decryptSecretSafe } from '../../../common/utils/secret-crypto.util';
import { redactOltCli } from '../utils/redact-olt-cli';
import { initialTr069Result, evidence, Tr069Result } from '../ports/tr069-provisioning.types';
import { GENIEACS_CLIENT } from '../../genieacs/genieacs-client-factory';
import { GenieAcsClient } from '../../genieacs/genieacs-client';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';

export const TR069_QUEUE = 'olt-tr069';
export interface Tr069Job { tenantSlug: string; operationId: string }
type Prepared = Awaited<ReturnType<OnuManagementService['prepareTr069Operation']>>;
export interface Tr069Request { tr069NetworkId: string; tr069AcsUsername?: string; tr069AcsPassword?: string }

@Injectable()
export class OnuTr069OperationsService {
  private readonly logger = new Logger(OnuTr069OperationsService.name);
  constructor(
    @InjectRepository(OnuTr069OperationEntity) private readonly operations: Repository<OnuTr069OperationEntity>,
    @InjectRepository(OnuServiceConfigEntity) private readonly configs: Repository<OnuServiceConfigEntity>,
    @InjectQueue(TR069_QUEUE) private readonly queue: Queue<Tr069Job>,
    private readonly management: OnuManagementService,
    private readonly wan: OnuWanProvisioningService,
    private readonly tenant: TenantContextService,
    private readonly tenants: TenantIteratorService,
    @Inject(GENIEACS_CLIENT) private readonly acs: GenieAcsClient | null,
    private readonly audit: DeviceOperationLogger,
  ) {}

  async create(onuId: string, request: Tr069Request, kind: 'profile' | 'acs', actor?: string, key: string = randomUUID()) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(key)) throw new BadRequestException('Clave de idempotencia inválida.');
    const keyMaterial = process.env.COMPANY_SECRETS_ENCRYPTION_KEY;
    if (!keyMaterial) throw new BadRequestException('Falta COMPANY_SECRETS_ENCRYPTION_KEY para proteger las operaciones.');
    const fingerprint = createHmac('sha256', keyMaterial).update(JSON.stringify([kind, request.tr069NetworkId, request.tr069AcsUsername || '', request.tr069AcsPassword || ''])).digest('hex');
    // An idempotent retry must work even while the worker holds the ONU lock.
    const existing = await this.operations.createQueryBuilder('op').addSelect('op.fingerprint').where('op.onuId = :onuId AND op.requestKey = :key', { onuId, key }).getOne();
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ConflictException('La clave de idempotencia ya corresponde a otra solicitud.');
      return { operationId: existing.id, status: existing.status, statusUrl: `/olt/onus/${onuId}/tr069-operations/${existing.id}` };
    }
    const operation = await this.wan.withMutation(onuId, async () => {
      const prior = await this.operations.createQueryBuilder('op').addSelect('op.fingerprint').where('op.onuId = :onuId AND op.requestKey = :key', { onuId, key }).getOne();
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ConflictException('La clave de idempotencia ya corresponde a otra solicitud.');
        return prior;
      }
      if (await this.operations.findOneBy({ onuId, status: In(['queued', 'running']) })) throw new ConflictException('Ya existe una operación TR-069 pendiente para esta ONU.');
      const prepared = await this.management.prepareTr069Operation(onuId, request, kind);
      const operationId = randomUUID();
      const payloadEnc = encryptSecret(JSON.stringify({ tenantId: this.tenant.getTenantId(), operationId, prepared }))!;
      return this.tenant.getDataSource().transaction(async manager => {
        const repo = manager.getRepository(OnuServiceConfigEntity);
        let config = await repo.findOne({ where: { onuId }, lock: { mode: 'pessimistic_write' } });
        if (!config) config = repo.create({ onuId, managementMethod: 'TR069', operationMode: 'ROUTER' });
        config.desiredVersion = Math.max(config.desiredVersion || 0, config.appliedVersion || 0) + 1;
        config.applyStatus = 'PENDING';
        config.lastApplyError = 'Operación TR-069 en cola.';
        // A request is an intention, not evidence that Internet or TR-069 was applied.
        await repo.save(config);
        return manager.getRepository(OnuTr069OperationEntity).save({
          id: operationId, onuId, kind, version: config.desiredVersion, requestKey: key, fingerprint, payloadEnc,
          status: 'queued', stage: 'queued', result: null, actorId: actor || null, attempts: 0,
          expiresAt: new Date(Date.now() + 30 * 60000), targetAcsUrl: redactOltCli(prepared.auth.tr069Url!), serialNumber: prepared.auth.serialNumber,
        });
      });
    });
    // The database row is the outbox. Redis failure is recovered by the cron.
    if (operation.status === 'queued') await this.enqueue(operation.id).catch(() => this.logger.warn('TR069 persistido; pendiente de entrega a la cola.'));
    return { operationId: operation.id, status: operation.status, statusUrl: `/olt/onus/${onuId}/tr069-operations/${operation.id}` };
  }

  private async enqueue(operationId: string) {
    const data = { tenantSlug: this.tenant.getSlug(), operationId };
    const jobId = `${data.tenantSlug}-${operationId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing && ['completed', 'failed'].includes(await existing.getState())) await existing.remove();
    await this.queue.add('apply', data, { jobId, attempts: 1, removeOnComplete: true, removeOnFail: 50 });
  }

  async get(onuId: string, id: string) {
    const operation = await this.operations.findOneBy({ id, onuId });
    if (!operation) throw new NotFoundException('Operación TR-069 no encontrada.');
    return operation;
  }
  async latest(onuId: string) {
    return this.operations.findOne({ where: { onuId }, order: { createdAt: 'DESC' } });
  }

  async process(id: string): Promise<void> {
    const initial = await this.operations.findOneBy({ id });
    if (!initial || !['queued', 'running'].includes(initial.status)) return;
    await this.wan.withMutation(initial.onuId, async () => {
      const operation = await this.operations.createQueryBuilder('op').addSelect('op.payloadEnc').where('op.id = :id', { id }).getOne();
      if (!operation || !['queued', 'running'].includes(operation.status)) return;
      let result: Tr069Result;
      const executionStarted = Date.now();
      const monotonicStarted = performance.now();
      let prepared: Prepared | undefined;
      try {
        if (Date.now() > operation.expiresAt.getTime()) throw new Error('La solicitud expiró antes de completarse.');
        const payload = decryptSecretSafe(operation.payloadEnc);
        if (!payload) throw new Error('Las credenciales temporales ya no están disponibles.');
        let envelope: { tenantId: string; operationId: string; prepared: Prepared };
        try { envelope = JSON.parse(payload); } catch { throw new Error('Payload temporal inválido.'); }
        if (envelope.tenantId !== this.tenant.getTenantId() || envelope.operationId !== id) throw new Error('El payload no pertenece a esta operación.');
        prepared = envelope.prepared;
        if (!prepared) throw new Error('Solicitud incompleta.');
        const config = await this.configs.findOneBy({ onuId: operation.onuId });
        if (config?.desiredVersion !== operation.version) throw new Error('La configuración deseada cambió; esta solicitud está obsoleta.');
        // A redelivery always starts with fresh device observations in the driver.
        await this.operations.update(id, { status: 'running', stage: 'preflight', attempts: operation.attempts + 1, startedAt: operation.startedAt || new Date() });
        operation.status = 'running';
        operation.startedAt ||= new Date(executionStarted);
        prepared.auth.onTr069Stage = async stage => { await this.operations.update(id, { stage }); };
        prepared.auth.tr069RemainingMs = () => Math.max(0, Math.min(300000 - (performance.now() - monotonicStarted), operation.expiresAt.getTime() - Date.now()));
        result = await this.management.executePreparedTr069(operation.onuId, prepared.auth, operation.kind, prepared.oltId);
        result.operationId = id;
        if (result.evidence.ip.status === 'confirmed' && !ipInManagementCidr(result.evidence.ip.reason?.match(/\d+\.\d+\.\d+\.\d+/)?.[0], prepared.cidr)) {
          result.evidence.ip = evidence('failed', 'management-network', 'La dirección observada no pertenece al CIDR de gestión seleccionado.');
        }
        if (result.ok && prepared.auth.tr069RemainingMs() > 0) await this.verifyAcs(operation, result);
      } catch (error) {
        result = initialTr069Result();
        result.operationId = id;
        result.status = operation.status === 'running' ? 'partial' : 'failed';
        result.error = redactOltCli(String((error as Error).message), [prepared?.auth.tr069AcsUsername, prepared?.auth.tr069AcsPassword]);
        result.issues.push({ stage: 'operation', code: 'OPERATION_INTERRUPTED', message: result.error });
      }
      result.queueWaitMs = Math.max(0, executionStarted - operation.createdAt.getTime());
      result.durationMs = Math.round(performance.now() - monotonicStarted);
      await this.tenant.getDataSource().transaction(async manager => {
        await manager.getRepository(OnuTr069OperationEntity).update(id, {
          status: result.status, stage: result.stage, result, payloadEnc: null, finishedAt: new Date(),
          nextCheckAt: result.status === 'applied_unverified' ? new Date(Date.now() + 60000) : null,
        });
        if (prepared && result.configurationStatus === 'confirmed' && result.persistenceStatus === 'confirmed') {
          await manager.getRepository(OnuServiceConfigEntity).update({ onuId: operation.onuId, desiredVersion: operation.version }, {
            managementMethod: 'TR069', tr069NetworkId: prepared.networkId,
            ...(operation.kind === 'profile' ? { tr069VlanId: prepared.vlanId } : {}),
            appliedVersion: operation.version, applyStatus: 'APPLIED', lastApplyError: null as any,
          });
        } else {
          await manager.getRepository(OnuServiceConfigEntity).update({ onuId: operation.onuId, desiredVersion: operation.version }, {
            applyStatus: 'ERROR', lastApplyError: result.error || 'La configuración TR-069 no pudo confirmarse.',
          });
        }
      });
      const onu = await this.management.findById(operation.onuId);
      await this.audit.logEvent({
        nodeId: onu.olt.viaNodeId || onu.olt.id, actorUserId: operation.actorId || undefined, eventType: 'PROVISION',
        status: result.ok ? 'SUCCESS' : 'FAILURE',
        message: `TR-069 ${result.status}; configuración ${result.configurationStatus}; ACS ${result.evidence.acs.status}.`,
        rawDetails: { operationId: id, onuId: operation.onuId, result },
      });
    });
  }

  private async verifyAcs(operation: OnuTr069OperationEntity, result: Tr069Result): Promise<void> {
    // An explicit CWMP URL is required to bind the global NBI client to its target ACS.
    if (!this.acs || !process.env.GENIEACS_CWMP_URL || redactOltCli(process.env.GENIEACS_CWMP_URL) !== operation.targetAcsUrl) {
      result.evidence.acs = evidence('unknown', 'GenieACS', 'La instancia NBI no tiene una URL CWMP de destino coincidente.');
      return;
    }
    try {
      const deviceId = await this.acs.findDeviceBySerial(operation.serialNumber, { exactOnly: true });
      const status = deviceId ? await this.acs.getDeviceStatus(deviceId) : undefined;
      const appliedAt = new Date(Math.max((operation.startedAt || operation.createdAt).getTime(), new Date(result.evidence.persistence.at).getTime()));
      const fresh = status?.serialNumber?.toUpperCase() === operation.serialNumber.toUpperCase() &&
        !!status.lastInformAt && status.lastInformAt >= appliedAt && status.lastInformAt.getTime() <= Date.now() + 30000 &&
        status.tags.includes('tenant:' + this.tenant.getSlug());
      result.evidence.acs = evidence(fresh ? 'confirmed' : 'unknown', 'GenieACS', fresh ? 'Inform nuevo de la ONU en el ACS de destino.' : 'Falta Inform nuevo con identidad y tenant confirmados.');
      if (fresh && result.evidence.omci.status === 'confirmed' && result.evidence.ip.status === 'confirmed') {
        result.status = 'verified'; result.warning = undefined;
      }
    } catch { result.evidence.acs = evidence('unknown', 'GenieACS', 'No se pudo consultar el ACS de destino.'); }
  }

  @Cron('0 * * * * *')
  async recover(): Promise<void> {
    await this.tenants.runForEachActiveTenant('olt-tr069', async () => {
      // Stalled running rows are re-delivered too. ONU advisory exclusion prevents parallel I/O.
      const pending = await this.operations.find({ where: { status: In(['queued', 'running']) }, order: { createdAt: 'ASC' }, take: 50 });
      for (const operation of pending) {
        if (operation.expiresAt.getTime() < Date.now()) {
          try {
            await this.wan.withMutation(operation.onuId, async () => {
              const expired = { ...initialTr069Result(), status: operation.status === 'running' ? 'partial' as const : 'failed' as const,
                operationId: operation.id, stage: 'expired', error: 'La operación expiró; se eliminaron sus credenciales temporales.' };
              await this.tenant.getDataSource().transaction(async manager => {
                const changed = await manager.getRepository(OnuTr069OperationEntity).update({ id: operation.id, status: operation.status }, { status: expired.status, result: expired, payloadEnc: null, stage: 'expired', finishedAt: new Date() });
                if (changed.affected) await manager.getRepository(OnuServiceConfigEntity).update({ onuId: operation.onuId, desiredVersion: operation.version }, { applyStatus: 'ERROR', lastApplyError: expired.error });
              });
            });
          } catch { /* Active ONU writer owns the operation; retry cleanup on the next tick. */ }
        } else await this.enqueue(operation.id).catch(() => undefined);
      }
      const checks = await this.operations.find({ where: { status: 'applied_unverified', nextCheckAt: LessThanOrEqual(new Date()) }, take: 50 });
      for (const operation of checks) {
        if (!operation.result) continue;
        if (operation.finishedAt && Date.now() - operation.finishedAt.getTime() > 15 * 60000) {
          await this.operations.update(operation.id, { nextCheckAt: null }); continue;
        }
        try {
          await this.wan.withMutation(operation.onuId, async () => {
            const cidr = await this.management.observeTr069Operation(operation.onuId, operation.version, operation.serialNumber, operation.result!);
            if (cidr === false) { await this.operations.update(operation.id, { nextCheckAt: null }); return; }
            if (!ipInManagementCidr(operation.result!.evidence.ip.reason?.match(/\d+\.\d+\.\d+\.\d+/)?.[0], cidr)) {
              operation.result!.evidence.ip = evidence('unknown', 'management-network', 'IP de gestión no comprobada contra el CIDR seleccionado.');
            }
            await this.verifyAcs(operation, operation.result!); // Read only: never reapplies OMCI.
            const count = operation.verificationChecks + 1;
            await this.operations.update(operation.id, {
              result: operation.result, status: operation.result!.status, verificationChecks: count,
              nextCheckAt: operation.result!.status !== 'verified' && count < 10 ? new Date(Date.now() + 60000) : null,
            });
          });
        } catch { this.logger.warn('Verificación TR069 pospuesta; equipo ocupado o consulta no disponible.'); }
      }
    });
  }
}

export function ipInManagementCidr(ip: string | undefined, cidr: string): boolean {
  const address = (value: string) => {
    const bytes = value.split('.');
    if (bytes.length !== 4 || bytes.some(byte => !/^\d{1,3}$/.test(byte) || Number(byte) > 255)) return undefined;
    return bytes.reduce((n, byte) => (n * 256 + Number(byte)) >>> 0, 0);
  };
  const [network, bits] = cidr.split('/');
  if (!ip || !/^\d+$/.test(bits || '') || Number(bits) > 32) return false;
  const a = address(ip), b = address(network);
  const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return a !== undefined && b !== undefined && (a & mask) === (b & mask);
}
