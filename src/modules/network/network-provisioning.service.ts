import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { ProvisioningAuditLogEntity } from './entities/provisioning-audit-log.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { NetworkProvisioningPort, ProvisioningResult } from './network-provisioning.port';
import { NetworkProvisioningPortRegistry } from './network-provisioning-port.registry';
import { UpsertNetworkAccessDto } from './dto/upsert-network-access.dto';
import { FindAuditLogDto } from './dto/find-audit-log.dto';
import { buildRouterProfileName } from './routeros/router-profile-name.util';

type AuditAction = 'CREATE' | 'PROVISION' | 'SUSPEND' | 'RESTORE' | 'DEPROVISION' | 'SYNC_PROFILE';

export interface AuditLogEntry {
  id: string;
  contractId: string;
  contractNumber?: string;
  clientId?: string;
  clientName?: string;
  nodeId?: string;
  nodeName?: string;
  action: string;
  result: 'OK' | 'ERROR';
  errorMessage?: string;
  reason?: string;
  actor: string;
  createdAt: Date;
}

export interface PaginatedAuditLog {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Orquesta el ciclo de vida del acceso de red de un contrato. Es el único
 * punto de entrada al dominio de red desde afuera del módulo (los listeners
 * de eventos y el controlador de configuración lo usan; nadie llama al
 * adaptador de aprovisionamiento directamente).
 */
@Injectable()
export class NetworkProvisioningService {
  private readonly logger = new Logger(NetworkProvisioningService.name);

  constructor(
    @InjectRepository(NetworkAccessEntity)
    private readonly accessRepository: Repository<NetworkAccessEntity>,
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(ProvisioningAuditLogEntity)
    private readonly auditRepository: Repository<ProvisioningAuditLogEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    private readonly portRegistry: NetworkProvisioningPortRegistry,
  ) {}

  /**
   * Crea el acceso de red de un contrato nuevo, en PENDING, a la espera de
   * que un administrador lo configure (nodo + usuario) vía upsertConfiguration.
   * Idempotente: si el contrato ya tiene un acceso, lo devuelve sin duplicar
   * ni volver a auditar nada — protege contra reintentos del listener de
   * CONTRACT_CREATED o contra una corrida repetida de la migración de datos
   * heredados (Fase 04 del plan de integración).
   */
  async createAccessForContract(contractId: string): Promise<NetworkAccessEntity> {
    const existing = await this.accessRepository.findOneBy({ contractId });
    if (existing) {
      return existing;
    }

    const access = this.accessRepository.create({
      contractId,
      connectionStatus: 'PENDING',
      provisioningSource: 'MANUAL',
    });
    const saved = await this.accessRepository.save(access);
    await this.recordAudit(saved, 'CREATE', { ok: true });
    return saved;
  }

  async findByContractId(contractId: string): Promise<NetworkAccessEntity | null> {
    return this.accessRepository.findOne({ where: { contractId }, relations: ['node', 'node.zone'] });
  }

  /**
   * Backfill de datos heredados (Fase 04 del plan de integración): fija el
   * acceso de red exactamente como venía en el export del sistema anterior
   * (incluyendo `connectionStatus`), sin pasar por la transición PENDING→
   * ACTIVE de `upsertConfiguration` — un import histórico no es un evento de
   * aprovisionamiento en vivo, así que tampoco invoca al puerto. Idempotente:
   * correr el import dos veces sobre el mismo contrato actualiza la misma
   * fila en vez de duplicarla.
   */
  async importLegacyAccess(
    contractId: string,
    data: {
      nodeId?: string;
      username?: string;
      serviceAlias?: string;
      ipAddress?: string;
      connectionStatus: NetworkAccessEntity['connectionStatus'];
    },
  ): Promise<NetworkAccessEntity> {
    const access =
      (await this.accessRepository.findOneBy({ contractId })) ??
      this.accessRepository.create({ contractId, provisioningSource: 'MANUAL' });

    access.nodeId = data.nodeId;
    access.username = data.username;
    access.serviceAlias = data.serviceAlias;
    access.ipAddress = data.ipAddress;
    access.connectionStatus = data.connectionStatus;

    const saved = await this.accessRepository.save(access);
    await this.recordAudit(saved, 'CREATE', { ok: true }, 'IMPORT');
    return saved;
  }

  /**
   * Alta/edición de la configuración de red de un contrato (upsert): nodo,
   * usuario PPPoE, alias de servicio e IP. Si tras aplicar los cambios el
   * acceso queda con nodo + usuario y todavía estaba en PENDING, se considera
   * aprovisionado y pasa a ACTIVE a través del puerto de aprovisionamiento.
   */
  async upsertConfiguration(
    clientId: string,
    contractId: string,
    dto: UpsertNetworkAccessDto,
  ): Promise<NetworkAccessEntity> {
    await this.assertContractBelongsToClient(clientId, contractId);

    if (dto.nodeId) {
      await this.assertNodeExists(dto.nodeId);
    }

    const access = (await this.accessRepository.findOneBy({ contractId })) ?? (await this.createAccessForContract(contractId));

    const wasPending = access.connectionStatus === 'PENDING';

    if (dto.nodeId !== undefined) access.nodeId = dto.nodeId;
    if (dto.username !== undefined) access.username = dto.username;
    if (dto.serviceAlias !== undefined) access.serviceAlias = dto.serviceAlias;
    if (dto.ipAddress !== undefined) access.ipAddress = dto.ipAddress;

    const saved = await this.accessRepository.save(access);

    if (wasPending && saved.nodeId && saved.username) {
      await this.transition(saved, 'PROVISION', 'ACTIVE', (port, acc) => port.provision(acc));
    }

    // Cada vez que se configura/edita el acceso (nodo o usuario nuevos), se
    // aprovecha para dejar el perfil de velocidad al día — cubre tanto el
    // aprovisionamiento inicial como una reasignación de nodo posterior.
    await this.syncProfileForContract(contractId);

    return (await this.findByContractId(contractId))!;
  }

  /**
   * Garantiza que el perfil de velocidad del plan contratado esté aplicado
   * en el nodo real (Fase 07). No es un error que no haya nada que
   * sincronizar todavía — devuelve null en esos casos, sin auditar ruido:
   * contrato/plan inexistente, plan sin velocidad (ej. solo TV, speedMbps=0
   * — sincronizarlo dejaría al cliente con un perfil de 0 Mbps), o acceso
   * sin nodo/usuario configurados aún.
   */
  async syncProfileForContract(contractId: string): Promise<NetworkAccessEntity | null> {
    const contract = await this.contractRepository.findOne({ where: { id: contractId }, relations: ['plan'] });
    if (!contract || !contract.plan) {
      this.logger.warn(`No se encontró el contrato o su plan para sincronizar el perfil de red (contrato ${contractId}).`);
      return null;
    }

    const speedMbps = Number(contract.plan.speedMbps);
    if (!speedMbps || speedMbps <= 0) {
      return null;
    }

    const access = await this.accessRepository.findOneBy({ contractId });
    if (!access) {
      return null;
    }
    if (!access.nodeId || !access.username) {
      // Todavía no hay nada configurado en el nodo para este acceso.
      return access;
    }

    const port = await this.resolvePort(access);
    const result = await port.syncProfile(access, { name: buildRouterProfileName(speedMbps), rateLimitMbps: speedMbps });

    access.lastSyncAt = new Date();
    access.lastSyncError = result.ok ? null : result.error || 'Error desconocido sincronizando el perfil de velocidad.';

    const saved = await this.accessRepository.save(access);
    await this.recordAudit(saved, 'SYNC_PROFILE', result);
    return saved;
  }

  /** Disparado por CONTRACT_SUSPENDED. Idempotente si ya estaba SUSPENDED/CUT. */
  async suspend(contractId: string, reason?: string): Promise<NetworkAccessEntity | null> {
    const access = await this.accessRepository.findOneBy({ contractId });
    if (!access) {
      this.logger.warn(`No hay acceso de red para el contrato ${contractId}; se ignora la suspensión.`);
      return null;
    }
    if (access.connectionStatus === 'SUSPENDED' || access.connectionStatus === 'CUT') {
      return access;
    }
    return this.transition(access, 'SUSPEND', 'SUSPENDED', (port, acc) => port.suspend(acc), reason);
  }

  /** Disparado por CONTRACT_REACTIVATED. Idempotente si ya estaba ACTIVE/CUT. */
  async restore(contractId: string, reason?: string): Promise<NetworkAccessEntity | null> {
    const access = await this.accessRepository.findOneBy({ contractId });
    if (!access) {
      this.logger.warn(`No hay acceso de red para el contrato ${contractId}; se ignora la restauración.`);
      return null;
    }
    if (access.connectionStatus === 'ACTIVE' || access.connectionStatus === 'CUT') {
      return access;
    }
    return this.transition(access, 'RESTORE', 'ACTIVE', (port, acc) => port.restore(acc), reason);
  }

  /** Disparado por CONTRACT_TERMINATED. CUT es terminal; idempotente si ya estaba CUT. */
  async deprovision(contractId: string, reason?: string): Promise<NetworkAccessEntity | null> {
    const access = await this.accessRepository.findOneBy({ contractId });
    if (!access) {
      this.logger.warn(`No hay acceso de red para el contrato ${contractId}; se ignora el corte.`);
      return null;
    }
    if (access.connectionStatus === 'CUT') {
      return access;
    }
    return this.transition(access, 'DEPROVISION', 'CUT', (port, acc) => port.deprovision(acc), reason);
  }

  /**
   * Historial de auditoría de red (Fase 09), con nombres legibles de
   * cliente/contrato/nodo en vez de solo IDs — pensado para responder
   * "¿por qué a este cliente le cortaron el servicio?" desde la UI, no solo
   * desde la base de datos.
   */
  async findAuditLog(dto: FindAuditLogDto): Promise<PaginatedAuditLog> {
    const page = dto.page || 1;
    const limit = dto.limit || 10;
    const skip = (page - 1) * limit;

    // leftJoinAndSelect (no un select parcial con getRawAndEntities) a
    // propósito: hidrata entidades completas y evita depender del formato
    // exacto de los alias de columna que TypeORM genera para raw rows —
    // menos código y no se rompe si cambia la naming strategy del proyecto.
    const query = this.auditRepository
      .createQueryBuilder('audit')
      .leftJoinAndSelect('audit.access', 'access')
      .leftJoinAndSelect('access.contract', 'contract')
      .leftJoinAndSelect('contract.client', 'client')
      .leftJoinAndSelect('access.node', 'node');

    if (dto.contractId) {
      query.andWhere('audit.contractId = :contractId', { contractId: dto.contractId });
    }
    if (dto.nodeId) {
      query.andWhere('access.nodeId = :nodeId', { nodeId: dto.nodeId });
    }
    if (dto.action) {
      query.andWhere('audit.action = :action', { action: dto.action });
    }
    if (dto.result) {
      query.andWhere('audit.result = :result', { result: dto.result });
    }

    query.orderBy('audit.createdAt', 'DESC').skip(skip).take(limit);

    const [entries, total] = await query.getManyAndCount();

    const data: AuditLogEntry[] = entries.map((entry) => ({
      id: entry.id,
      contractId: entry.contractId,
      contractNumber: entry.access?.contract?.contractNumber,
      clientId: entry.access?.contract?.client?.id,
      clientName: entry.access?.contract?.client?.name,
      nodeId: entry.access?.node?.id,
      nodeName: entry.access?.node?.name,
      action: entry.action,
      result: entry.result,
      errorMessage: entry.errorMessage,
      reason: entry.reason,
      actor: entry.actor,
      createdAt: entry.createdAt,
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private async transition(
    access: NetworkAccessEntity,
    action: AuditAction,
    nextStatusOnSuccess: NetworkAccessEntity['connectionStatus'],
    invoke: (port: NetworkProvisioningPort, access: NetworkAccessEntity) => Promise<ProvisioningResult>,
    reason?: string,
  ): Promise<NetworkAccessEntity> {
    const port = await this.resolvePort(access);
    const result = await invoke(port, access);

    access.lastSyncAt = new Date();
    if (result.ok) {
      access.connectionStatus = nextStatusOnSuccess;
      access.lastSyncError = null;
    } else {
      access.lastSyncError = result.error || 'Error desconocido de aprovisionamiento';
    }

    const saved = await this.accessRepository.save(access);
    await this.recordAudit(saved, action, result, 'SYSTEM', reason);
    return saved;
  }

  /** El adaptador se elige por el nodo del acceso (provisioningMode), no globalmente — ver NetworkProvisioningPortRegistry. */
  private async resolvePort(access: NetworkAccessEntity): Promise<NetworkProvisioningPort> {
    if (!access.nodeId) {
      return this.portRegistry.resolve('MANUAL');
    }
    const node = await this.nodeRepository.findOneBy({ id: access.nodeId });
    return this.portRegistry.resolve(node?.provisioningMode);
  }

  private async recordAudit(
    access: NetworkAccessEntity,
    action: AuditAction,
    result: ProvisioningResult,
    actor: string = 'SYSTEM',
    reason?: string,
  ): Promise<void> {
    await this.auditRepository.save(
      this.auditRepository.create({
        accessId: access.id,
        contractId: access.contractId,
        action,
        result: result.ok ? 'OK' : 'ERROR',
        errorMessage: result.ok ? undefined : result.error,
        actor,
        reason,
      }),
    );
  }

  private async assertContractBelongsToClient(clientId: string, contractId: string): Promise<void> {
    const contract = await this.contractRepository.findOneBy({ id: contractId, clientId });
    if (!contract) {
      throw new NotFoundException(`Contrato ${contractId} no encontrado para el cliente ${clientId}`);
    }
  }

  private async assertNodeExists(nodeId: string): Promise<void> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red con ID ${nodeId} no encontrado`);
    }
  }
}
