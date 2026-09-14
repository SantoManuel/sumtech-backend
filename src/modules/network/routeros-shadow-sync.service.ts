import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { ProvisioningAuditLogEntity } from './entities/provisioning-audit-log.entity';
import { resolveRouterOsCredentials } from './routeros/routeros-credentials';
import { ROUTEROS_CLIENT_FACTORY, RouterOsClientFactory, RouterOsClientLike } from './routeros/routeros-client-factory';

export interface ShadowCheckRowResult {
  accessId: string;
  contractId: string;
  username: string;
  sumtechStatus: NetworkAccessEntity['connectionStatus'];
  routerFound: boolean;
  routerDisabled?: boolean;
  drift: boolean;
  detail: string;
}

export interface ShadowCheckSummary {
  nodeId: string;
  nodeName: string;
  connectionOk: boolean;
  connectionError?: string;
  rows: ShadowCheckRowResult[];
}

/**
 * Fase 05 del plan de integración con Mikrotik: compara el estado real de un
 * nodo (vía la REST API de RouterOS) contra lo que Sumtech tiene en
 * net.network_access, sin aplicar ningún cambio — "modo sombra" en sentido
 * estricto. Cada acceso comparado queda auditado (SHADOW_CHECK) para poder
 * revisar el histórico de desincronizaciones antes de activar cualquier
 * corte/restauración real (Fase 06).
 */
@Injectable()
export class RouterOsShadowSyncService {
  private readonly logger = new Logger(RouterOsShadowSyncService.name);

  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(NetworkAccessEntity)
    private readonly accessRepository: Repository<NetworkAccessEntity>,
    @InjectRepository(ProvisioningAuditLogEntity)
    private readonly auditRepository: Repository<ProvisioningAuditLogEntity>,
    @Inject(ROUTEROS_CLIENT_FACTORY)
    private readonly clientFactory: RouterOsClientFactory,
  ) {}

  async checkNode(nodeId: string): Promise<ShadowCheckSummary> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red con ID ${nodeId} no encontrado`);
    }
    if (!node.managementIp) {
      throw new BadRequestException(`El nodo "${node.name}" no tiene IP de gestión configurada`);
    }

    const credentials = resolveRouterOsCredentials(node.name);
    const client = this.clientFactory({
      managementIp: node.managementIp,
      apiPort: node.apiPort,
      useHttps: node.useHttps,
      username: credentials.username,
      password: credentials.password,
    });

    const connection = await client.testConnection();
    if (!connection.ok) {
      await this.nodeRepository.update(node.id, { lastSyncAt: new Date(), lastSyncStatus: 'ERROR' });
      this.logger.warn(`No se pudo conectar al nodo "${node.name}": ${connection.error}`);
      return { nodeId: node.id, nodeName: node.name, connectionOk: false, connectionError: connection.error, rows: [] };
    }

    const accesses = await this.accessRepository.find({ where: { nodeId } });
    const rows: ShadowCheckRowResult[] = [];

    for (const access of accesses) {
      rows.push(await this.checkAccess(access, client));
    }

    await this.nodeRepository.update(node.id, { lastSyncAt: new Date(), lastSyncStatus: 'OK' });
    return { nodeId: node.id, nodeName: node.name, connectionOk: true, rows };
  }

  private async checkAccess(access: NetworkAccessEntity, client: RouterOsClientLike): Promise<ShadowCheckRowResult> {
    if (!access.username) {
      return {
        accessId: access.id,
        contractId: access.contractId,
        username: '',
        sumtechStatus: access.connectionStatus,
        routerFound: false,
        drift: false,
        detail: 'Sin usuario PPPoE configurado en Sumtech; no hay nada que comparar contra el nodo.',
      };
    }

    try {
      const secret = await client.findPppSecretByName(access.username);

      if (!secret) {
        const result: ShadowCheckRowResult = {
          accessId: access.id,
          contractId: access.contractId,
          username: access.username,
          sumtechStatus: access.connectionStatus,
          routerFound: false,
          drift: true,
          detail: 'Sumtech tiene este usuario configurado, pero no existe ningún secreto PPP con ese nombre en el nodo.',
        };
        await this.recordShadowCheck(access, false, result.detail);
        return result;
      }

      const expectedDisabled = access.connectionStatus === 'SUSPENDED' || access.connectionStatus === 'CUT';
      const drift = secret.disabled !== expectedDisabled;
      const detail = drift
        ? `Sumtech dice "${access.connectionStatus}" (disabled esperado=${expectedDisabled}) pero el nodo tiene disabled=${secret.disabled}.`
        : 'Coincide.';

      await this.recordShadowCheck(access, !drift, drift ? detail : undefined);
      return {
        accessId: access.id,
        contractId: access.contractId,
        username: access.username,
        sumtechStatus: access.connectionStatus,
        routerFound: true,
        routerDisabled: secret.disabled,
        drift,
        detail,
      };
    } catch (error: any) {
      const detail = `Error consultando el nodo: ${error.message}`;
      await this.recordShadowCheck(access, false, detail);
      return {
        accessId: access.id,
        contractId: access.contractId,
        username: access.username,
        sumtechStatus: access.connectionStatus,
        routerFound: false,
        drift: true,
        detail,
      };
    }
  }

  /**
   * Registra el hallazgo en el log de auditoría Y lo refleja en el propio
   * NetworkAccessEntity (lastSyncAt/lastSyncError — las mismas columnas que
   * ya usa NetworkProvisioningService) para que la desincronización sea
   * visible donde el resto de la UI ya la lee (badge de red del cliente),
   * sin esperar a que alguien vaya a revisar el log de auditoría.
   */
  private async recordShadowCheck(access: NetworkAccessEntity, ok: boolean, detail?: string): Promise<void> {
    await this.auditRepository.save(
      this.auditRepository.create({
        accessId: access.id,
        contractId: access.contractId,
        action: 'SHADOW_CHECK',
        result: ok ? 'OK' : 'ERROR',
        errorMessage: ok ? undefined : detail,
        actor: 'SHADOW_SYNC',
      }),
    );
    await this.accessRepository.update(access.id, {
      lastSyncAt: new Date(),
      lastSyncError: ok ? null : detail || 'Desincronización detectada contra el nodo real.',
    });
  }
}
