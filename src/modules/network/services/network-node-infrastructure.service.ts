import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { NetworkNodeVlanEntity } from '../entities/network-node-vlan.entity';
import { VlanEntity } from '../../olt/entities/vlan.entity';
import { ROUTEROS_CLIENT_FACTORY, RouterOsClientFactory, RouterOsClientLike } from '../routeros/routeros-client-factory';
import { resolveRouterOsCredentials } from '../routeros/routeros-credentials';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';

export interface SyncVlanOptions {
  uplinkInterface: string;
  gatewayCidr?: string;
}

export interface EnsureDhcpServerForVlanOptions {
  /** Rango de IPs para el pool DHCP, formato RouterOS (ej. "10.20.0.10-10.20.0.250"). */
  poolRange: string;
  dnsServers?: string;
  leaseTimeSec?: number;
}

/** "10.20.0.1/24" -> "10.20.0.0/24" (dirección de red, requerida por /ip/dhcp-server/network). */
function networkAddressFromGatewayCidr(gatewayCidr: string): string {
  const [ip, prefixStr] = gatewayCidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  if (!ip || Number.isNaN(prefix)) {
    throw new Error(`gatewayCidr con formato inesperado: "${gatewayCidr}" (se esperaba "<ip>/<prefijo>")`);
  }
  const octets = ip.split('.').map(Number);
  const mask = ~((1 << (32 - prefix)) - 1) >>> 0;
  const ipInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const networkInt = (ipInt & mask) >>> 0;
  const networkOctets = [24, 16, 8, 0].map((shift) => (networkInt >>> shift) & 255);
  return `${networkOctets.join('.')}/${prefix}`;
}

/**
 * Materializa en el MikroTik real la configuración base del nodo (Fase A del
 * plan de automatización del Core/Gateway): VLANs de cliente sobre el puerto
 * que conecta a la OLT. En RouterOS no existe un "modo trunk" aparte — un
 * puerto con varias VLANs sobre él ya es, por definición, un trunk — así que
 * esta es también la implementación de "configurar el puerto trunk hacia la
 * OLT".
 */
@Injectable()
export class NetworkNodeInfrastructureService {
  private readonly logger = new Logger(NetworkNodeInfrastructureService.name);

  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(NetworkNodeVlanEntity)
    private readonly nodeVlanRepository: Repository<NetworkNodeVlanEntity>,
    @InjectRepository(VlanEntity)
    private readonly vlanRepository: Repository<VlanEntity>,
    @Inject(ROUTEROS_CLIENT_FACTORY)
    private readonly clientFactory: RouterOsClientFactory,
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly deviceOperationLogger: DeviceOperationLogger,
  ) {}

  /**
   * Asegura que la VLAN exista como sub-interfaz real en el router, con su
   * IP de gateway si se especifica. Idempotente: puede llamarse varias veces
   * sin duplicar nada (ver RouterOsClient.ensureVlanInterface/ensureIpAddress).
   */
  async syncVlan(
    nodeId: string,
    vlanId: string,
    options: SyncVlanOptions,
    actorUserId?: string,
  ): Promise<NetworkNodeVlanEntity> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }
    const vlan = await this.vlanRepository.findOneBy({ id: vlanId });
    if (!vlan) {
      throw new NotFoundException(`VLAN no encontrada: ${vlanId}`);
    }

    let record = await this.nodeVlanRepository.findOneBy({ nodeId, vlanId });
    if (!record) {
      record = this.nodeVlanRepository.create({
        nodeId,
        vlanId,
        uplinkInterface: options.uplinkInterface,
        gatewayCidr: options.gatewayCidr,
        applyStatus: 'PENDING',
      });
    } else {
      record.uplinkInterface = options.uplinkInterface;
      record.gatewayCidr = options.gatewayCidr;
    }

    const interfaceName = `vlan${vlan.vlanId}`;

    try {
      const client = await this.resolveClient(node);

      await client.ensureVlanInterface({
        name: interfaceName,
        vlanId: vlan.vlanId,
        parentInterface: options.uplinkInterface,
        comment: `Sumtech - ${vlan.name}`,
      });

      if (options.gatewayCidr) {
        await client.ensureIpAddress(interfaceName, options.gatewayCidr, `Sumtech - Gateway ${vlan.name}`);
      }

      record.applyStatus = 'APPLIED';
      record.lastSyncAt = new Date();
      record.lastSyncError = undefined;
      await this.nodeVlanRepository.save(record);

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `VLAN ${vlan.vlanId} (${vlan.name}) sincronizada en "${node.name}" sobre ${options.uplinkInterface}.`,
        actorUserId,
        rawDetails: { nodeId: node.id, vlanId: vlan.id, uplinkInterface: options.uplinkInterface, operation: 'syncVlan' },
      });

      return record;
    } catch (err: any) {
      record.applyStatus = 'ERROR';
      record.lastSyncAt = new Date();
      record.lastSyncError = err.message;
      await this.nodeVlanRepository.save(record);

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'FAILURE',
        message: `Error sincronizando VLAN ${vlan.vlanId} en "${node.name}": ${err.message}`,
        actorUserId,
        rawDetails: { nodeId: node.id, vlanId: vlan.id, operation: 'syncVlan' },
      });

      throw err;
    }
  }

  async listVlans(nodeId: string): Promise<NetworkNodeVlanEntity[]> {
    return this.nodeVlanRepository.find({ where: { nodeId }, relations: ['vlan'], order: { createdAt: 'ASC' } });
  }

  /**
   * Asegura la infraestructura DHCP completa (pool + red + servidor) sobre
   * la sub-interfaz VLAN ya sincronizada en la Fase A — requisito para que
   * el medio de suspensión DHCP (Fase D) pueda asignar leases estáticas a
   * clientes en esa VLAN. Nombres deterministas (`pool-vlan<id>`,
   * `dhcp-vlan<id>`) para que DhcpProvisioningAdapter pueda resolverlos sin
   * tener que guardar una referencia aparte.
   */
  async ensureDhcpServerForVlan(
    nodeId: string,
    vlanId: string,
    options: EnsureDhcpServerForVlanOptions,
    actorUserId?: string,
  ): Promise<NetworkNodeVlanEntity> {
    const nodeVlan = await this.nodeVlanRepository.findOne({ where: { nodeId, vlanId }, relations: ['vlan', 'node'] });
    if (!nodeVlan) {
      throw new NotFoundException(
        `No hay una VLAN sincronizada para este nodo todavía — corre primero la sincronización de VLAN (Fase A).`,
      );
    }
    if (!nodeVlan.gatewayCidr) {
      throw new BadRequestException(`La VLAN ${nodeVlan.vlan.vlanId} en este nodo no tiene IP de gateway configurada.`);
    }

    const node = nodeVlan.node || (await this.nodeRepository.findOneBy({ id: nodeId }))!;
    const interfaceName = `vlan${nodeVlan.vlan.vlanId}`;
    const poolName = `pool-vlan${nodeVlan.vlan.vlanId}`;
    const serverName = `dhcp-vlan${nodeVlan.vlan.vlanId}`;
    const [gatewayIp] = nodeVlan.gatewayCidr.split('/');
    const networkCidr = networkAddressFromGatewayCidr(nodeVlan.gatewayCidr);

    try {
      const client = await this.resolveClient(node);

      await client.ensureIpPool(poolName, options.poolRange);
      await client.ensureDhcpServerNetwork(networkCidr, gatewayIp, options.dnsServers);
      await client.ensureDhcpServer(serverName, interfaceName, poolName, options.leaseTimeSec ?? 86400);

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Servidor DHCP asegurado para VLAN ${nodeVlan.vlan.vlanId} en "${node.name}".`,
        actorUserId,
        rawDetails: { nodeId: node.id, vlanId, operation: 'ensureDhcpServerForVlan' },
      });

      return nodeVlan;
    } catch (err: any) {
      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'FAILURE',
        message: `Error asegurando servidor DHCP para VLAN ${nodeVlan.vlan.vlanId} en "${node.name}": ${err.message}`,
        actorUserId,
        rawDetails: { nodeId: node.id, vlanId, operation: 'ensureDhcpServerForVlan' },
      });
      throw err;
    }
  }

  /**
   * NAT de salida (masquerade) sobre la interfaz WAN del nodo — sin esto
   * ningún cliente detrás del router sale a Internet aunque el WAN ya tenga
   * IP real. Depende de que `wanInterfaceName` ya esté configurado (Fase B).
   */
  async ensureNatMasquerade(nodeId: string, actorUserId?: string): Promise<NetworkNodeEntity> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }
    if (!node.wanInterfaceName) {
      throw new BadRequestException(`El nodo "${node.name}" no tiene configurada la interfaz WAN.`);
    }

    try {
      const client = await this.resolveClient(node);
      await client.ensureNatMasquerade(node.wanInterfaceName, 'sumtech-nat-masquerade');

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `NAT masquerade asegurado en "${node.name}" sobre ${node.wanInterfaceName}.`,
        actorUserId,
        rawDetails: { nodeId: node.id, operation: 'ensureNatMasquerade' },
      });

      return node;
    } catch (err: any) {
      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'FAILURE',
        message: `Error asegurando NAT masquerade en "${node.name}": ${err.message}`,
        actorUserId,
        rawDetails: { nodeId: node.id, operation: 'ensureNatMasquerade' },
      });
      throw err;
    }
  }

  /**
   * Set fijo y mínimo de reglas de firewall (ver RouterOsClient.ensureFirewallBaseline
   * para el detalle y por qué deliberadamente NO incluye restricción de acceso
   * de gestión por IP).
   */
  async ensureFirewallBaseline(nodeId: string, actorUserId?: string): Promise<NetworkNodeEntity> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }

    try {
      const client = await this.resolveClient(node);
      await client.ensureFirewallBaseline();

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Reglas de firewall base aplicadas en "${node.name}".`,
        actorUserId,
        rawDetails: { nodeId: node.id, operation: 'ensureFirewallBaseline' },
      });

      return node;
    } catch (err: any) {
      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'FAILURE',
        message: `Error aplicando reglas de firewall base en "${node.name}": ${err.message}`,
        actorUserId,
        rawDetails: { nodeId: node.id, operation: 'ensureFirewallBaseline' },
      });
      throw err;
    }
  }

  /**
   * Asegura la auto-configuración TR-069 vía DHCP Option 43 (ver
   * RouterOsClient.ensureAcsAutoProvisioning para el detalle del mecanismo
   * TR-069 Annex G). `server` por defecto es 'all': el matcher solo activa
   * para clientes DHCP que declaren soporte TR-069 (Option 60 contiene
   * "dslforum.org"), así que cubrir todos los servidores DHCP del router no
   * amplía el radio de impacto hacia clientes que no lo pidieron.
   */
  async ensureAcsAutoProvisioning(nodeId: string, acsUrl: string, actorUserId?: string): Promise<NetworkNodeEntity> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }

    try {
      const client = await this.resolveClient(node);
      await client.ensureAcsAutoProvisioning(acsUrl);

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Auto-configuración TR-069 (DHCP Option 43) asegurada en "${node.name}" con ACS ${acsUrl}.`,
        actorUserId,
        rawDetails: { nodeId: node.id, operation: 'ensureAcsAutoProvisioning', acsUrl },
      });

      return node;
    } catch (err: any) {
      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'FAILURE',
        message: `Error asegurando auto-configuración TR-069 en "${node.name}": ${err.message}`,
        actorUserId,
        rawDetails: { nodeId: node.id, operation: 'ensureAcsAutoProvisioning', acsUrl },
      });
      throw err;
    }
  }

  /**
   * Materializa el WAN del nodo según `wanMode`:
   * - DHCP_CLIENT / PPPOE_CLIENT ya agregan su propia ruta por defecto
   *   (add-default-route=yes) — no hace falta `ensureDefaultRoute` para esos.
   * - STATIC requiere IP, gateway y DNS ya cargados en el nodo (ver
   *   wan_static_*, cargados vía NodeFormModal) y aquí sí se asegura la
   *   ruta por defecto explícitamente.
   */
  async ensureWan(nodeId: string, actorUserId?: string): Promise<NetworkNodeEntity> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }
    if (!node.wanInterfaceName) {
      throw new BadRequestException(`El nodo "${node.name}" no tiene configurada la interfaz WAN.`);
    }

    try {
      const client = await this.resolveClient(node);

      if (node.wanMode === 'STATIC') {
        if (!node.wanStaticIp || !node.wanStaticGateway) {
          throw new BadRequestException(`El nodo "${node.name}" está en modo WAN estático pero le falta IP o gateway.`);
        }
        await client.ensureIpAddress(node.wanInterfaceName, node.wanStaticIp, 'Sumtech - WAN estática');
        await client.ensureDefaultRoute(node.wanStaticGateway, 'Sumtech - WAN estática');
      } else if (node.wanMode === 'PPPOE_CLIENT') {
        if (!node.wanPppoeUsername || !node.wanPppoePasswordEnc) {
          throw new BadRequestException(`El nodo "${node.name}" está en modo WAN PPPoE-client pero le faltan credenciales.`);
        }
        await client.ensurePppoeClient({
          name: 'sumtech-wan-pppoe',
          parentInterface: node.wanInterfaceName,
          user: node.wanPppoeUsername,
          password: decryptCredential(node.wanPppoePasswordEnc),
          addDefaultRoute: true,
        });
      } else {
        await client.ensureDhcpClient(node.wanInterfaceName, true);
      }

      node.wanLastSyncAt = new Date();
      node.wanLastSyncError = undefined;
      await this.nodeRepository.save(node);

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `WAN (${node.wanMode}) sincronizado en "${node.name}" sobre ${node.wanInterfaceName}.`,
        actorUserId,
        rawDetails: { nodeId: node.id, wanMode: node.wanMode, operation: 'ensureWan' },
      });

      return node;
    } catch (err: any) {
      node.wanLastSyncAt = new Date();
      node.wanLastSyncError = err.message;
      await this.nodeRepository.save(node);

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'FAILURE',
        message: `Error sincronizando WAN en "${node.name}": ${err.message}`,
        actorUserId,
        rawDetails: { nodeId: node.id, operation: 'ensureWan' },
      });

      throw err;
    }
  }

  /** Mismo patrón de resolución de cliente RouterOS ya usado en PppManagementService/RouterOsProvisioningAdapter. */
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

    return this.clientFactory({ managementIp: host, apiPort: port, useHttps, username, password });
  }
}
