import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkProvisioningPort, ProvisioningResult, RouterProfileTarget } from './network-provisioning.port';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { VlanEntity } from '../olt/entities/vlan.entity';
import { resolveRouterOsCredentials } from './routeros/routeros-credentials';
import { ROUTEROS_CLIENT_FACTORY, RouterOsClientFactory, RouterOsClientLike } from './routeros/routeros-client-factory';
import { buildSymmetricRateLimit } from './routeros/router-profile-name.util';
import { ReachabilityResolver } from '../network-connectivity/services/reachability-resolver.service';
import { decryptCredential } from '../network-connectivity/utils/crypto.util';

type NodeAndClient =
  | { ok: true; node: NetworkNodeEntity; client: RouterOsClientLike; serverName: string }
  | { ok: false; error: string };

/**
 * Adaptador de aprovisionamiento DHCP (Fase D del plan de automatización del
 * Core/Gateway MikroTik) — alternativa completa a PPPoE, con su propio ciclo
 * de vida de suspensión/reactivación, para clientes sin autenticación PPPoE.
 *
 * La identidad del cliente en este medio es su `macAddress` con una lease
 * estática (`ip/dhcp-server/lease`), equivalente al secret PPPoE. El
 * servidor DHCP se resuelve por convención determinista a partir de la VLAN
 * del acceso (`dhcp-vlan<vlanId>`, ver NetworkNodeInfrastructureService.ensureDhcpServerForVlan) —
 * nunca se adivina ni se guarda por separado.
 */
@Injectable()
export class DhcpProvisioningAdapter extends NetworkProvisioningPort {
  private readonly logger = new Logger(DhcpProvisioningAdapter.name);

  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(VlanEntity)
    private readonly vlanRepository: Repository<VlanEntity>,
    @Inject(ROUTEROS_CLIENT_FACTORY)
    private readonly clientFactory: RouterOsClientFactory,
    private readonly reachabilityResolver: ReachabilityResolver,
  ) {
    super();
  }

  async provision(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    if (!access.macAddress || !access.ipAddress) {
      return { ok: false, error: 'Medio DHCP requiere MAC address e IP asignadas al acceso.' };
    }
    const resolved = await this.resolveNodeClientAndServer(access);
    if (!resolved.ok) return resolved;
    const { node, client, serverName } = resolved;

    try {
      await client.ensureStaticLease(access.macAddress, access.ipAddress, serverName, `Contrato:${access.contractId}`);
      this.logger.log(`[DHCP] Lease asegurada para ${access.macAddress} (${access.ipAddress}) en nodo "${node.name}".`);
      return { ok: true };
    } catch (err: any) {
      this.logger.error(`[DHCP] Error aprovisionando lease para ${access.macAddress}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  async suspend(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    return this.setDisabled(access, true);
  }

  async restore(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    return this.setDisabled(access, false);
  }

  async deprovision(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    return this.setDisabled(access, true);
  }

  /**
   * Equivalente DHCP del perfil PPP con rate-limit: asegura una simple-queue
   * (`/queue/simple`) apuntando a la IP del cliente, usando el mismo formato
   * "N M/N M" simétrico ya usado para PPPoE (buildSymmetricRateLimit).
   */
  async syncProfile(access: NetworkAccessEntity, profile: RouterProfileTarget): Promise<ProvisioningResult> {
    if (!access.ipAddress) {
      return { ok: false, error: 'Medio DHCP requiere una IP asignada al acceso para aplicar el límite de velocidad.' };
    }
    const resolved = await this.resolveNodeClientAndServer(access);
    if (!resolved.ok) return resolved;
    const { node, client } = resolved;

    try {
      await client.ensureSimpleQueue(this.queueName(access), `${access.ipAddress}/32`, buildSymmetricRateLimit(profile.rateLimitMbps));
      this.logger.log(`[DHCP] Queue "${this.queueName(access)}" asegurada en "${node.name}" (${profile.rateLimitMbps}Mbps).`);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  private queueName(access: NetworkAccessEntity): string {
    return `sumtech-${access.contractId}`;
  }

  private async setDisabled(access: NetworkAccessEntity, disabled: boolean): Promise<ProvisioningResult> {
    const resolved = await this.resolveNodeClientAndServer(access);
    if (!resolved.ok) return resolved;
    const { client } = resolved;

    try {
      const lease = await client.findStaticLeaseByMac(access.macAddress!);
      if (lease && lease.disabled !== disabled) {
        await client.setLeaseDisabled(lease.id, disabled);
      }
      const queue = await client.findSimpleQueueByName(this.queueName(access));
      if (queue && queue.disabled !== disabled) {
        await client.setSimpleQueueDisabled(queue.id, disabled);
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  private async resolveNodeClientAndServer(access: NetworkAccessEntity): Promise<NodeAndClient> {
    if (!access.macAddress) {
      return { ok: false, error: 'El acceso no tiene MAC address configurada (requerida para el medio DHCP).' };
    }
    if (!access.nodeId) {
      return { ok: false, error: 'El acceso no tiene nodo de red asignado.' };
    }
    if (!access.vlanId) {
      return { ok: false, error: 'El acceso no tiene VLAN asignada (requerida para resolver el servidor DHCP).' };
    }

    const node = await this.nodeRepository.findOneBy({ id: access.nodeId });
    if (!node) {
      return { ok: false, error: 'El nodo de red asignado a este acceso ya no existe.' };
    }
    const vlan = await this.vlanRepository.findOneBy({ id: access.vlanId });
    if (!vlan) {
      return { ok: false, error: 'La VLAN asignada a este acceso ya no existe.' };
    }

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
      return { ok: false, error: `El nodo "${node.name}" no tiene IP de gestión o túnel WireGuard alcanzable.` };
    }

    let username = node.apiUser || 'admin';
    let password = '';

    if (node.apiPasswordEnc) {
      password = decryptCredential(node.apiPasswordEnc);
    } else {
      try {
        const credentials = resolveRouterOsCredentials(node.name);
        username = credentials.username;
        password = credentials.password;
      } catch (error: any) {
        return { ok: false, error: error.message };
      }
    }

    const client = this.clientFactory({ managementIp: host, apiPort: port, useHttps, username, password });
    return { ok: true, node, client, serverName: `dhcp-vlan${vlan.vlanId}` };
  }
}
