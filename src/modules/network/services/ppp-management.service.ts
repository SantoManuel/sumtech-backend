import { Injectable, NotFoundException, BadRequestException, GatewayTimeoutException, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { NetworkAccessEntity } from '../entities/network-access.entity';
import { NetworkNodeVlanEntity } from '../entities/network-node-vlan.entity';
import { ROUTEROS_CLIENT_FACTORY, RouterOsClientFactory, RouterOsClientLike } from '../routeros/routeros-client-factory';
import { RouterOsPppSecret, RouterOsActivePppSession, RouterOsIpPool } from '../routeros/routeros-client';
import { resolveRouterOsCredentials } from '../routeros/routeros-credentials';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { buildSymmetricRateLimit } from '../routeros/router-profile-name.util';
import { CreateRouterOsProfileDto, UpdateRouterOsProfileDto } from '../dto/routeros-profile.dto';
import { SyncCatalogProfilesDto } from '../dto/sync-catalog-profiles.dto';

export interface EnrichedRouterOsProfile {
  id: string;
  name: string;
  rateLimit?: string;
  parentQueue?: string;
  localAddress?: string;
  remoteAddress?: string;
  onlyOne?: boolean;
  dnsServer?: string;
  secretsCount: number;
  dynamicIpCount: number;
  staticIpCount: number;
  activeSessionsCount: number;
  associatedPlans: Array<{ id: string; name: string; speedMbps: number }>;
  isProtected: boolean;
}

export interface EnrichedPppSecret extends RouterOsPppSecret {
  isConnected: boolean;
  liveAddress?: string;
  liveUptime?: string;
  accessId?: string;
  contractId?: string;
  clientId?: string;
  clientName?: string;
}

export interface PppSessionDetails {
  isConnected: boolean;
  username?: string;
  ipAddress?: string;
  callerId?: string;
  uptime?: string;
  service?: string;
  encoding?: string;
  sessionId?: string;
  nodeName?: string;
}

/** "a.b.c.d" -> entero sin signo de 32 bits, o null si no es una IPv4 válida. */
function ipToLong(ip: string): number | null {
  const octets = ip.trim().split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    return null;
  }
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function longToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/**
 * Expande el string `ranges` de un /ip/pool de RouterOS (ej.
 * "192.168.60.10-192.168.60.250" o "192.168.60.5,192.168.60.10-192.168.60.20")
 * a la lista completa de direcciones individuales que contiene. `maxAddresses`
 * evita que un pool mal configurado (ej. un /8 por error de tipeo) cuelgue el
 * endpoint o devuelva un payload gigante.
 */
export function expandIpPoolRanges(ranges: string, maxAddresses = 10000): string[] {
  const addresses: string[] = [];
  const parts = (ranges || '').split(',').map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    if (addresses.length >= maxAddresses) break;
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map((p) => p.trim());
      const start = ipToLong(startStr);
      const end = ipToLong(endStr);
      if (start === null || end === null || end < start) continue;
      for (let n = start; n <= end && addresses.length < maxAddresses; n++) {
        addresses.push(longToIp(n));
      }
    } else {
      const n = ipToLong(part);
      if (n !== null) addresses.push(part);
    }
  }

  return addresses;
}

export function formatRateLimitWithBurst(
  baseRateLimit?: string,
  burstLimit?: string,
  burstThreshold?: string,
  burstTime?: string,
  priority?: number,
): string | undefined {
  if (!baseRateLimit) return undefined;
  if (!burstLimit && !burstThreshold && !burstTime && priority === undefined) {
    return baseRateLimit;
  }
  const bLimit = burstLimit || '0/0';
  const bThresh = burstThreshold || '0/0';
  const bTime = burstTime || '0/0';
  const prio = priority !== undefined ? String(priority) : '8';
  return `${baseRateLimit} ${bLimit} ${bThresh} ${bTime} ${prio}`;
}

@Injectable()
export class PppManagementService {
  private readonly logger = new Logger(PppManagementService.name);

  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(NetworkAccessEntity)
    private readonly accessRepository: Repository<NetworkAccessEntity>,
    @InjectRepository(NetworkNodeVlanEntity)
    private readonly nodeVlanRepository: Repository<NetworkNodeVlanEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
    @Inject(ROUTEROS_CLIENT_FACTORY)
    private readonly clientFactory: RouterOsClientFactory,
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly deviceOperationLogger: DeviceOperationLogger,
  ) {}

  /**
   * Obtiene la sesión activa en vivo de un acceso de red de cliente (RF-PPP-009).
   */
  async getAccessSession(accessId: string): Promise<PppSessionDetails> {
    const access = await this.accessRepository.findOne({
      where: { id: accessId },
      relations: ['node'],
    });

    if (!access) {
      throw new NotFoundException(`Acceso de red no encontrado: ${accessId}`);
    }

    if (!access.username || !access.node) {
      return { isConnected: false };
    }

    const client = await this.resolveClient(access.node);
    try {
      const active = await client.findActiveSessionByName(access.username);
      if (!active) {
        return {
          isConnected: false,
          username: access.username,
          nodeName: access.node.name,
        };
      }

      // Actualizar MAC en DB si cambió
      if (active.callerId && active.callerId !== access.macAddress) {
        await this.accessRepository.update(
          { id: access.id },
          { macAddress: active.callerId, lastCallerId: active.callerId },
        );
      }

      return {
        isConnected: true,
        username: active.name,
        ipAddress: active.address,
        callerId: active.callerId,
        uptime: active.uptime,
        service: active.service,
        encoding: active.encoding,
        sessionId: active.sessionId,
        nodeName: access.node.name,
      };
    } catch (err: any) {
      this.logger.warn(`Error consultando sesión activa de "${access.username}": ${err.message}`);
      return {
        isConnected: false,
        username: access.username,
        nodeName: access.node.name,
      };
    }
  }

  /**
   * Lista todas las sesiones PPPoE activas en un nodo MikroTik (RF-PPP-009).
   */
  async getNodeActiveSessions(nodeId: string) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    const client = await this.resolveClient(node);
    try {
      const sessions = await client.getActiveSessions();
      return {
        nodeId: node.id,
        nodeName: node.name,
        totalActive: sessions.length,
        sessions,
      };
    } catch (err: any) {
      this.logger.warn(`Error listando sesiones activas en nodo "${node.name}": ${err.message}`);
      throw new GatewayTimeoutException(
        `El nodo "${node.name}" (${node.wireguardIp || node.managementIp || 'desconocido'}) no respondio a tiempo: ${err.message}`,
      );
    }
  }

  /**
   * Lista los secrets PPPoE configurados de verdad en el router (/ppp/secret),
   * cruzados contra las sesiones activas (¿está conectado ahora?) y contra
   * `network_access` (¿de qué cliente/contrato es este secret, si Sumtech lo
   * conoce?). Antes de esto no existía ninguna vista de los secrets
   * configurados -- solo de sesiones activas -- así que un secret correctamente
   * creado pero nunca conectado (ONT con falla propia) era indistinguible de
   * uno que nunca se creó.
   */
  async getNodeConfiguredSecrets(nodeId: string) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    const client = await this.resolveClient(node);
    let secrets: RouterOsPppSecret[];
    let activeSessions: RouterOsActivePppSession[];
    try {
      [secrets, activeSessions] = await Promise.all([
        client.getPppSecrets(),
        client.getActiveSessions().catch((): RouterOsActivePppSession[] => []),
      ]);
    } catch (err: any) {
      this.logger.warn(`Error listando secrets PPP en nodo "${node.name}": ${err.message}`);
      throw new GatewayTimeoutException(
        `El nodo "${node.name}" (${node.wireguardIp || node.managementIp || 'desconocido'}) no respondio a tiempo: ${err.message}`,
      );
    }

    const activeByName = new Map(activeSessions.map((s) => [s.name, s]));

    const accesses = await this.accessRepository.find({
      where: { nodeId: node.id },
      relations: ['contract', 'contract.client'],
    });
    const accessByUsername = new Map(
      accesses.filter((a) => a.username).map((a) => [a.username as string, a]),
    );

    const enrichedSecrets: EnrichedPppSecret[] = secrets.map((secret) => {
      const active = activeByName.get(secret.name);
      const access = accessByUsername.get(secret.name);
      return {
        ...secret,
        isConnected: Boolean(active),
        liveAddress: active?.address,
        liveUptime: active?.uptime,
        accessId: access?.id,
        contractId: access?.contractId,
        clientId: access?.contract?.clientId,
        clientName: access?.contract?.client?.name,
      };
    });

    return {
      nodeId: node.id,
      nodeName: node.name,
      total: enrichedSecrets.length,
      secrets: enrichedSecrets,
    };
  }

  /**
   * Expulsa y desconecta forzosamente en caliente la sesión activa de un usuario en un router MikroTik específico (RF-PPP-008).
   */
  async disconnectNodeActiveSession(nodeId: string, username: string, actorUserId?: string): Promise<{ success: boolean; message: string }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    const client = await this.resolveClient(node);
    const killed = await client.killActiveSession(username);

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: killed
        ? `Sesión activa de "${username}" desconectada forzosamente en caliente.`
        : `No había sesión activa para "${username}" en el nodo.`,
      actorUserId,
    });

    return {
      success: true,
      message: killed
        ? `Sesión de "${username}" desconectada exitosamente.`
        : `El usuario "${username}" no estaba conectado.`,
    };
  }

  /**
   * Expulsa y desconecta en caliente la sesión activa de un cliente (RF-PPP-008).
   */
  async disconnectAccessSession(accessId: string, actorUserId?: string): Promise<{ success: boolean; message: string }> {
    const access = await this.accessRepository.findOne({
      where: { id: accessId },
      relations: ['node'],
    });

    if (!access) {
      throw new NotFoundException(`Acceso de red no encontrado: ${accessId}`);
    }
    if (!access.username || !access.node) {
      return { success: false, message: 'El acceso no tiene usuario o nodo configurado' };
    }

    const client = await this.resolveClient(access.node);
    const killed = await client.killActiveSession(access.username);

    await this.deviceOperationLogger.logEvent({
      nodeId: access.node.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: killed
        ? `Sesión activa de "${access.username}" desconectada forzosamente en caliente.`
        : `No había sesión activa para "${access.username}" en el nodo.`,
      actorUserId,
    });

    return {
      success: true,
      message: killed
        ? `Sesión de ${access.username} desconectada exitosamente.`
        : `El usuario ${access.username} no estaba conectado.`,
    };
  }

  /**
   * Sincroniza perfiles de velocidad del catálogo de planes en el MikroTik (RF-PPP-001/002/003).
   * Soporta sincronización selectiva de planes específicos y sobrescritura de pools/colas por lote.
   */
  async syncCatalogProfilesToNode(
    nodeId: string,
    dto?: SyncCatalogProfilesDto,
    actorUserId?: string,
  ) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    let plans = await this.planRepository.find({ where: { isActive: true } });
    if (dto?.planIds && dto.planIds.length > 0) {
      const allowedSet = new Set(dto.planIds);
      plans = plans.filter((p) => allowedSet.has(p.id));
    }

    const client = await this.resolveClient(node);

    // 1. Asegurar perfil de corte (si no se excluyó explícitamente)
    if (dto?.includeSuspensionProfile !== false) {
      try {
        await client.ensureSuspensionProfile('Sumtech-Corte', '256k/256k');
      } catch (err: any) {
        this.logger.warn(`No se pudo asegurar el perfil de corte en nodo "${node.name}": ${err.message}`);
      }
    }

    const targetPool = dto?.poolOverride?.trim() || node.defaultPppPool || undefined;
    const targetQueue = dto?.parentQueueOverride?.trim() || node.defaultParentQueue || undefined;
    const targetDns = dto?.dnsServersOverride?.trim() || node.defaultDnsServers || undefined;

    const results: Array<{
      planId: string;
      planName: string;
      profileName: string;
      rateLimit: string;
      pool: string | null;
      parentQueue: string | null;
      status: 'OK' | 'ERROR';
      error?: string;
    }> = [];

    for (const plan of plans) {
      const speed = plan.speedMbps || 10;
      const profileName = plan.pppProfileId?.trim() || `Sumtech-${speed}Mbps`;
      const rateLimit = buildSymmetricRateLimit(speed);

      try {
        await client.ensureProfile(profileName, rateLimit, {
          parentQueue: targetQueue,
          remoteAddress: targetPool,
          onlyOne: true,
          dnsServer: targetDns,
        });
        results.push({
          planId: plan.id,
          planName: plan.name,
          profileName,
          rateLimit,
          pool: targetPool || null,
          parentQueue: targetQueue || null,
          status: 'OK',
        });
      } catch (err: any) {
        results.push({
          planId: plan.id,
          planName: plan.name,
          profileName,
          rateLimit,
          pool: targetPool || null,
          parentQueue: targetQueue || null,
          status: 'ERROR',
          error: err.message,
        });
      }
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Sincronizados ${results.filter((r) => r.status === 'OK').length} perfiles en nodo "${node.name}"`,
      actorUserId,
      rawDetails: { results },
    });

    return {
      nodeId: node.id,
      nodeName: node.name,
      syncedProfiles: results,
      totalSuccess: results.filter((r) => r.status === 'OK').length,
      totalError: results.filter((r) => r.status === 'ERROR').length,
    };
  }

  /**
   * Obtiene la lista completa de perfiles PPP en el router con métricas de uso y jerarquía IP.
   */
  async getNodeProfiles(nodeId: string) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    let client: RouterOsClientLike;
    try {
      client = await this.resolveClient(node);
    } catch (err: any) {
      this.logger.warn(`No se pudo resolver cliente RouterOS para nodo "${node.name}": ${err.message}`);
      throw new GatewayTimeoutException(
        `No se pudo conectar con el nodo "${node.name}": ${err.message}`,
      );
    }

    let profiles: any[] = [];
    let secrets: RouterOsPppSecret[] = [];
    let activeSessions: RouterOsActivePppSession[] = [];
    let ipPools: RouterOsIpPool[] = [];
    let plans: PlanEntity[] = [];

    try {
      [profiles, secrets, activeSessions, ipPools, plans] = await Promise.all([
        client.getProfiles(),
        client.getPppSecrets().catch((): RouterOsPppSecret[] => []),
        client.getActiveSessions().catch((): RouterOsActivePppSession[] => []),
        client.getIpPools().catch((): RouterOsIpPool[] => []),
        this.planRepository.find({ where: { isActive: true } }),
      ]);
    } catch (err: any) {
      this.logger.warn(`Error comunicando con el router del nodo "${node.name}": ${err.message}`);
      throw new GatewayTimeoutException(
        `El nodo "${node.name}" (${node.wireguardIp || node.managementIp || 'desconocido'}) no respondio a tiempo: ${err.message}`,
      );
    }

    const enrichedProfiles: EnrichedRouterOsProfile[] = profiles.map((p) => {
      const matchingSecrets = secrets.filter((s) => s.profile === p.name);
      const staticIpCount = matchingSecrets.filter(
        (s) => s.remoteAddress && s.remoteAddress.trim().length > 0,
      ).length;
      const dynamicIpCount = matchingSecrets.length - staticIpCount;

      const matchingSecretNames = new Set(matchingSecrets.map((s) => s.name));
      const activeSessionsCount = activeSessions.filter((sess) =>
        matchingSecretNames.has(sess.name),
      ).length;

      const associatedPlans = plans
        .filter(
          (plan) =>
            plan.pppProfileId?.trim() === p.name ||
            (!plan.pppProfileId && p.name === `Sumtech-${plan.speedMbps}Mbps`),
        )
        .map((plan) => ({
          id: plan.id,
          name: plan.name,
          speedMbps: Number(plan.speedMbps),
        }));

      const isProtected = ['default', 'default-encryption', 'Sumtech-Corte'].includes(p.name);

      return {
        id: p.id,
        name: p.name,
        rateLimit: p.rateLimit,
        parentQueue: p.parentQueue,
        localAddress: p.localAddress,
        remoteAddress: p.remoteAddress,
        onlyOne: p.onlyOne,
        dnsServer: p.dnsServer,
        secretsCount: matchingSecrets.length,
        dynamicIpCount,
        staticIpCount,
        activeSessionsCount,
        associatedPlans,
        isProtected,
      };
    });

    return {
      nodeId: node.id,
      nodeName: node.name,
      profiles: enrichedProfiles,
      ipPools,
    };
  }

  /**
   * Obtiene la lista de pools de IP (/ip/pool) disponibles en el router.
   */
  async getNodeIpPools(nodeId: string) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    try {
      return await client.getIpPools();
    } catch (err: any) {
      this.logger.warn(`Error obteniendo IP pools en nodo "${node.name}": ${err.message}`);
      throw new GatewayTimeoutException(
        `El nodo "${node.name}" (${node.wireguardIp || node.managementIp || 'desconocido'}) no respondio a tiempo: ${err.message}`,
      );
    }
  }

  /**
   * Calcula las IPs libres del pool de un nodo cruzando el rango real
   * configurado en RouterOS con lo que ya está ocupado: IPs estáticas
   * guardadas en nuestra BD, secrets PPP con remote-address fijo, y leases
   * (estáticas o dinámicas) que el router ya tiene entregadas ahora mismo
   * (/ip/pool/used) — así "disponible" refleja la realidad del router, no
   * solo lo que SUMTECH recuerda haber asignado.
   */
  async getAvailableIps(
    nodeId: string,
    options?: { poolName?: string; vlanId?: string; limit?: number },
  ): Promise<{
    nodeId: string;
    nodeName: string;
    poolName: string;
    ranges: string;
    totalInRange: number;
    totalUsed: number;
    totalAvailable: number;
    available: string[];
  }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    // Prioridad: pool explícito (query param) > pool propio de la VLAN
    // elegida (net.network_node_vlans.ppp_pool, ver migración 091) > pool
    // default del nodo completo -- un nodo con una sola VLAN de servicio
    // sigue funcionando solo con el default; uno con varias VLANs necesita
    // el pool por VLAN para no sugerir IPs de la subred equivocada.
    let vlanPool: string | undefined;
    if (!options?.poolName?.trim() && options?.vlanId) {
      const nodeVlan = await this.nodeVlanRepository.findOne({ where: { nodeId, vlanId: options.vlanId } });
      vlanPool = nodeVlan?.pppPool || undefined;
    }

    const poolName = options?.poolName?.trim() || vlanPool || node.defaultPppPool;
    if (!poolName) {
      throw new BadRequestException(
        options?.vlanId
          ? `Ni la VLAN elegida ni el nodo "${node.name}" tienen un pool de IP configurado. Asígnalo en la pestaña "Pools de Direcciones IP".`
          : `El nodo "${node.name}" no tiene un pool de IP por defecto configurado (defaultPppPool). Configúralo en el nodo o indica un pool explícito.`,
      );
    }

    const client = await this.resolveClient(node);

    let pools: RouterOsIpPool[];
    try {
      pools = await client.getIpPools();
    } catch (err: any) {
      throw new GatewayTimeoutException(
        `El nodo "${node.name}" (${node.wireguardIp || node.managementIp || 'desconocido'}) no respondio a tiempo: ${err.message}`,
      );
    }

    const pool = pools.find((p) => p.name === poolName);
    if (!pool) {
      throw new NotFoundException(`No existe el pool "${poolName}" en el router del nodo "${node.name}".`);
    }

    const limit = options?.limit && options.limit > 0 ? Math.min(options.limit, 200) : 30;
    const allAddresses = expandIpPoolRanges(pool.ranges);

    const [dbUsedRows, secrets, dynamicUsed] = await Promise.all([
      this.accessRepository
        .createQueryBuilder('access')
        .select('access.ipAddress', 'ipAddress')
        .where('access.nodeId = :nodeId', { nodeId })
        .andWhere('access.ipAddress IS NOT NULL')
        .getRawMany<{ ipAddress: string }>(),
      client.getPppSecrets().catch((): RouterOsPppSecret[] => []),
      client.getUsedPoolAddresses(poolName).catch((): string[] => []),
    ]);

    const used = new Set<string>();
    dbUsedRows.forEach((row) => row.ipAddress && used.add(row.ipAddress));
    secrets.forEach((s) => s.remoteAddress && used.add(s.remoteAddress));
    dynamicUsed.forEach((ip) => used.add(ip));

    const available = allAddresses.filter((ip) => !used.has(ip));

    return {
      nodeId: node.id,
      nodeName: node.name,
      poolName,
      ranges: pool.ranges,
      totalInRange: allAddresses.length,
      totalUsed: used.size,
      totalAvailable: available.length,
      available: available.slice(0, limit),
    };
  }

  /**
   * Crea un pool de IPs desacoplado en el router (/ip/pool).
   */
  async createNodeIpPool(
    nodeId: string,
    dto: { name: string; ranges: string },
    actorUserId?: string,
  ): Promise<RouterOsIpPool> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    const created = await client.createIpPool(dto.name, dto.ranges);

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Pool de IP "${dto.name}" (${dto.ranges}) creado en router "${node.name}".`,
      actorUserId,
    });

    return created;
  }

  /**
   * Actualiza los rangos de un pool de IPs (/ip/pool).
   */
  async updateNodeIpPool(
    nodeId: string,
    poolId: string,
    dto: { ranges: string },
    actorUserId?: string,
  ): Promise<RouterOsIpPool> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    const updated = await client.updateIpPool(poolId, dto.ranges);

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Pool de IP "${poolId}" actualizado en router "${node.name}" (${dto.ranges}).`,
      actorUserId,
    });

    return updated;
  }

  /**
   * Elimina un pool de IPs (/ip/pool).
   */
  async deleteNodeIpPool(
    nodeId: string,
    poolId: string,
    actorUserId?: string,
  ): Promise<{ ok: boolean }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    await client.deleteIpPool(poolId);

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Pool de IP "${poolId}" eliminado en router "${node.name}".`,
      actorUserId,
    });

    return { ok: true };
  }

  /**
   * Crea un perfil nuevo en RouterOS con soporte opcional de QoS/Burst.
   */
  async createNodeProfile(
    nodeId: string,
    dto: CreateRouterOsProfileDto,
    actorUserId?: string,
  ) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    const client = await this.resolveClient(node);
    const existing = await client.findProfileByName(dto.name);
    if (existing) {
      throw new BadRequestException(`Ya existe un perfil con el nombre "${dto.name}" en este router.`);
    }

    const formattedRateLimit = formatRateLimitWithBurst(
      dto.rateLimit,
      dto.burstLimit,
      dto.burstThreshold,
      dto.burstTime,
      dto.priority,
    ) || dto.rateLimit;

    const created = await client.createProfile(dto.name, formattedRateLimit, {
      parentQueue: dto.parentQueue || undefined,
      localAddress: dto.localAddress || undefined,
      remoteAddress: dto.remoteAddress || undefined,
      onlyOne: dto.onlyOne !== undefined ? dto.onlyOne : true,
      dnsServer: dto.dnsServer || undefined,
    });

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Perfil PPP "${dto.name}" creado en router "${node.name}" (${formattedRateLimit}).`,
      actorUserId,
    });

    return created;
  }

  /**
   * Actualiza los atributos de un perfil existente en RouterOS.
   */
  async updateNodeProfile(
    nodeId: string,
    profileId: string,
    dto: UpdateRouterOsProfileDto,
    actorUserId?: string,
  ) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    const formattedRateLimit = formatRateLimitWithBurst(
      dto.rateLimit,
      dto.burstLimit,
      dto.burstThreshold,
      dto.burstTime,
      dto.priority,
    );

    const client = await this.resolveClient(node);
    await client.updateProfile(profileId, formattedRateLimit, {
      parentQueue: dto.parentQueue,
      localAddress: dto.localAddress,
      remoteAddress: dto.remoteAddress,
      onlyOne: dto.onlyOne,
      dnsServer: dto.dnsServer,
    });

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Perfil PPP "${profileId}" actualizado en router "${node.name}".`,
      actorUserId,
    });

    return { success: true, message: 'Perfil actualizado exitosamente en el router.' };
  }

  /**
   * Elimina un perfil de RouterOS tras validar protecciones y dependencias.
   */
  async deleteNodeProfile(nodeId: string, profileId: string, actorUserId?: string) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    const client = await this.resolveClient(node);
    const profiles = await client.getProfiles();
    const target = profiles.find((p) => p.id === profileId || p.name === profileId);
    if (!target) {
      throw new NotFoundException(`Perfil no encontrado en el router: ${profileId}`);
    }

    if (['default', 'default-encryption', 'Sumtech-Corte'].includes(target.name)) {
      throw new BadRequestException(
        `El perfil "${target.name}" es un perfil protegido del sistema y no puede ser eliminado.`,
      );
    }

    const secrets = await client.getPppSecrets().catch((): RouterOsPppSecret[] => []);
    const inUseSecrets = secrets.filter((s) => s.profile === target.name);
    if (inUseSecrets.length > 0) {
      throw new BadRequestException(
        `No se puede eliminar el perfil "${target.name}" porque tiene ${inUseSecrets.length} secretos/clientes asignados en el router.`,
      );
    }

    const plans = await this.planRepository.find({ where: { isActive: true } });
    const linkedPlans = plans.filter(
      (p) =>
        p.pppProfileId?.trim() === target.name ||
        (!p.pppProfileId && target.name === `Sumtech-${p.speedMbps}Mbps`),
    );
    if (linkedPlans.length > 0) {
      throw new BadRequestException(
        `No se puede eliminar el perfil "${target.name}" porque está vinculado al plan comercial "${linkedPlans[0].name}". Modifique el plan en el módulo de Planes antes de eliminar el perfil.`,
      );
    }

    await client.deleteProfile(target.id);

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Perfil PPP "${target.name}" eliminado del router "${node.name}".`,
      actorUserId,
    });

    return { success: true, message: `Perfil "${target.name}" eliminado exitosamente.` };
  }

  private async resolveClient(node: NetworkNodeEntity): Promise<RouterOsClientLike> {
    let host = node.managementIp;
    let port = node.apiPort;
    let useHttps = node.useHttps;

    try {
      const endpoint = await this.reachabilityResolver.resolveEndpoint(node);
      host = endpoint.host;
      port = endpoint.port;
      useHttps = endpoint.useHttps;
    } catch {
      // Fallback a managementIp
    }

    if (!host) {
      throw new Error(`El nodo "${node.name}" no tiene IP de gestión o túnel alcanzable.`);
    }

    let username = node.apiUser || 'admin';
    let password = '';

    if (node.apiPasswordEnc) {
      password = decryptCredential(node.apiPasswordEnc);
    } else {
      const credentials = resolveRouterOsCredentials(node.name);
      username = credentials.username;
      password = credentials.password;
    }

    return this.clientFactory({
      managementIp: host,
      apiPort: port,
      useHttps,
      username,
      password,
    });
  }
}
