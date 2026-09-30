import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { RouterOsClientFactory, ROUTEROS_CLIENT_FACTORY } from '../routeros/routeros-client-factory';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';
import { resolveRouterOsCredentials } from '../routeros/routeros-credentials';

@Injectable()
export class SuspensionPortalManagerService {
  private readonly logger = new Logger(SuspensionPortalManagerService.name);

  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @Inject(ROUTEROS_CLIENT_FACTORY)
    private readonly clientFactory: RouterOsClientFactory,
    private readonly deviceOperationLogger: DeviceOperationLogger,
    private readonly reachabilityResolver: ReachabilityResolver,
  ) {}

  /**
   * Instala las reglas de firewall y dst-nat en el router MikroTik para el portal cautivo de aviso.
   * RF-PORTAL-001.
   */
  async installPortalRules(nodeId: string, actorUserId?: string): Promise<{ success: boolean; message: string }> {
    const node = await this.nodeRepository.findOne({ where: { id: nodeId } });
    if (!node) throw new NotFoundException(`Router no encontrado: ${nodeId}`);

    if (node.provisioningMode === 'MANUAL') {
      node.portalInstalled = true;
      node.portalInstalledAt = new Date();
      node.portalRulesStatus = 'INSTALLED';
      await this.nodeRepository.save(node);
      return { success: true, message: 'Portal marcado como configurado manualmente.' };
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
      throw new BadRequestException(`El nodo "${node.name}" no tiene IP de gestión o túnel WireGuard alcanzable.`);
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
      } catch (err: any) {
        throw new BadRequestException(err.message);
      }
    }

    const client = this.clientFactory({
      managementIp: host,
      apiPort: port,
      useHttps,
      username,
      password,
    });

    const portalIp = node.portalIp || node.wireguardIp || '10.15.0.1';
    const portalPort = node.portalPort || 80;

    try {
      this.logger.log(`[PORTAL-INSTALL] Configurando firewall en ${node.name} hacia ${portalIp}:${portalPort}`);

      // 1. Regla NAT: Redirigir tráfico HTTP (puerto 80) de sumtech-suspendidos al portal
      await client.addFirewallNatRule({
        chain: 'dstnat',
        protocol: 'tcp',
        'dst-port': '80',
        'src-address-list': 'sumtech-suspendidos',
        action: 'dst-nat',
        'to-addresses': portalIp,
        'to-ports': String(portalPort),
        comment: 'SUMTECH-PORTAL-NAT',
      });

      // 2. Reglas Filter: Permitir DNS UDP/TCP, permitir acceso HTTP al portal, dropear el resto
      await client.addFirewallFilterRule({
        chain: 'forward',
        protocol: 'udp',
        'dst-port': '53',
        'src-address-list': 'sumtech-suspendidos',
        action: 'accept',
        comment: 'SUMTECH-PORTAL-ALLOW-DNS-UDP',
      });

      await client.addFirewallFilterRule({
        chain: 'forward',
        protocol: 'tcp',
        'dst-port': '53',
        'src-address-list': 'sumtech-suspendidos',
        action: 'accept',
        comment: 'SUMTECH-PORTAL-ALLOW-DNS-TCP',
      });

      await client.addFirewallFilterRule({
        chain: 'forward',
        'dst-address': portalIp,
        'src-address-list': 'sumtech-suspendidos',
        action: 'accept',
        comment: 'SUMTECH-PORTAL-ALLOW-HTTP',
      });

      await client.addFirewallFilterRule({
        chain: 'forward',
        'src-address-list': 'sumtech-suspendidos',
        action: 'drop',
        comment: 'SUMTECH-PORTAL-DROP-REST',
      });

      // 3. Actualizar estado del nodo en la base de datos
      node.portalInstalled = true;
      node.portalInstalledAt = new Date();
      node.portalRulesStatus = 'INSTALLED';
      await this.nodeRepository.save(node);

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Reglas de portal de suspensión instaladas en MikroTik "${node.name}" redirigiendo a ${portalIp}:${portalPort}.`,
        actorUserId,
      });

      return {
        success: true,
        message: `Portal de aviso instalado correctamente en ${node.name}.`,
      };
    } catch (err: any) {
      node.portalRulesStatus = 'ERROR';
      await this.nodeRepository.save(node);
      this.logger.error(`[PORTAL-INSTALL] Error instalando reglas en ${node.name}: ${err.message}`);
      throw new BadRequestException(`No se pudo instalar el portal en MikroTik: ${err.message}`);
    }
  }

  /**
   * Consulta el estado de las reglas del portal en el router.
   */
  async getPortalStatus(nodeId: string): Promise<any> {
    const node = await this.nodeRepository.findOne({ where: { id: nodeId } });
    if (!node) throw new NotFoundException(`Router no encontrado: ${nodeId}`);

    return {
      nodeId: node.id,
      nodeName: node.name,
      suspensionMode: node.suspensionMode,
      portalInstalled: node.portalInstalled,
      portalInstalledAt: node.portalInstalledAt,
      portalRulesStatus: node.portalRulesStatus,
      portalIp: node.portalIp || '10.15.0.1',
      portalPort: node.portalPort || 80,
    };
  }
}
