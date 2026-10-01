import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { NetworkAccessEntity } from '../entities/network-access.entity';
import { ROUTEROS_CLIENT_FACTORY, RouterOsClientFactory, RouterOsClientLike } from '../routeros/routeros-client-factory';
import { RouterOsPppSecret, RouterOsActivePppSession, RouterOsIpPool } from '../routeros/routeros-client';
import { resolveRouterOsCredentials } from '../routeros/routeros-credentials';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { buildSymmetricRateLimit } from '../routeros/router-profile-name.util';
import { CreateRouterOsProfileDto, UpdateRouterOsProfileDto } from '../dto/routeros-profile.dto';

export interface EnrichedRouterOsProfile {
  id: string;
  name: string;
  rateLimit?: string;
  parentQueue?: string;
  localAddress?: string;
  remoteAddress?: string;
  onlyOne?: boolean;
  secretsCount: number;
  dynamicIpCount: number;
  staticIpCount: number;
  activeSessionsCount: number;
  associatedPlans: Array<{ id: string; name: string; speedMbps: number }>;
  isProtected: boolean;
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

@Injectable()
export class PppManagementService {
  private readonly logger = new Logger(PppManagementService.name);

  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(NetworkAccessEntity)
    private readonly accessRepository: Repository<NetworkAccessEntity>,
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
      this.logger.error(`Error listando sesiones activas en nodo "${node.name}": ${err.message}`);
      throw err;
    }
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
   * Sincroniza todos los perfiles de velocidad del catálogo de planes en el MikroTik (RF-PPP-001/002/003).
   */
  async syncCatalogProfilesToNode(nodeId: string, actorUserId?: string) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    const plans = await this.planRepository.find({ where: { isActive: true } });
    const client = await this.resolveClient(node);

    // 1. Asegurar perfil de corte
    await client.ensureSuspensionProfile('Sumtech-Corte', '256k/256k');

    const results: Array<{
      planId: string;
      planName: string;
      profileName: string;
      status: string;
      error?: string;
    }> = [];
    for (const plan of plans) {
      const speed = plan.speedMbps || 10;
      const profileName = plan.pppProfileId?.trim() || `Sumtech-${speed}Mbps`;
      const rateLimit = buildSymmetricRateLimit(speed);

      try {
        await client.ensureProfile(profileName, rateLimit, {
          parentQueue: node.defaultParentQueue || undefined,
          remoteAddress: node.defaultPppPool || undefined,
          onlyOne: true,
        });
        results.push({ planId: plan.id, planName: plan.name, profileName, status: 'OK' });
      } catch (err: any) {
        results.push({ planId: plan.id, planName: plan.name, profileName, status: 'ERROR', error: err.message });
      }
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Sincronizados ${results.length} perfiles de velocidad en nodo "${node.name}"`,
      actorUserId,
      rawDetails: { results },
    });

    return {
      nodeId: node.id,
      nodeName: node.name,
      syncedProfiles: results,
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

    const client = await this.resolveClient(node);
    const [profiles, secrets, activeSessions, ipPools, plans] = await Promise.all([
      client.getProfiles(),
      client.getPppSecrets().catch((): RouterOsPppSecret[] => []),
      client.getActiveSessions().catch((): RouterOsActivePppSession[] => []),
      client.getIpPools().catch((): RouterOsIpPool[] => []),
      this.planRepository.find({ where: { isActive: true } }),
    ]);

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
    return client.getIpPools();
  }

  /**
   * Crea un perfil nuevo en RouterOS.
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

    const created = await client.createProfile(dto.name, dto.rateLimit, {
      parentQueue: dto.parentQueue || undefined,
      localAddress: dto.localAddress || undefined,
      remoteAddress: dto.remoteAddress || undefined,
      onlyOne: dto.onlyOne !== undefined ? dto.onlyOne : true,
    });

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Perfil PPP "${dto.name}" creado en router "${node.name}" (${dto.rateLimit}).`,
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

    const client = await this.resolveClient(node);
    await client.updateProfile(profileId, dto.rateLimit, {
      parentQueue: dto.parentQueue,
      localAddress: dto.localAddress,
      remoteAddress: dto.remoteAddress,
      onlyOne: dto.onlyOne,
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
