import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { NetworkNodeVlanEntity } from '../entities/network-node-vlan.entity';
import { VlanEntity } from '../../olt/entities/vlan.entity';
import { ROUTEROS_CLIENT_FACTORY, RouterOsClientFactory, RouterOsClientLike } from '../routeros/routeros-client-factory';
import {
  RouterOsUpdateInfo,
  RouterOsInterfaceItem,
  RouterOsDhcpLease,
  RouterOsSimpleQueue,
  RouterOsLogEntry,
} from '../routeros/routeros-client';
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

export interface EnsurePppoeServerForVlanOptions {
  serviceName?: string;
  defaultProfile?: string;
  oneSessionPerHost?: boolean;
  authentication?: string;
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
    // Resync explícito del usuario sobre una VLAN que ya estaba aplicada con
    // otro gateway -- a diferencia de una colisión accidental, aquí se
    // permite reemplazar la IP en el router (ver ensureIpAddress allowReplace).
    const isGatewayChange = Boolean(record && options.gatewayCidr && record.gatewayCidr !== options.gatewayCidr);
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
        await client.ensureIpAddress(interfaceName, options.gatewayCidr, `Sumtech - Gateway ${vlan.name}`, isGatewayChange);
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
   * Descubre las sub-interfaces VLAN que REALMENTE existen en el router,
   * comparadas contra lo que Sumtech ya tiene registrado en
   * `net.network_node_vlans`. Solo lectura -- no crea nada todavía (ver
   * `importDiscoveredVlan`). Necesario porque `listVlans()` solo refleja lo
   * que el propio Sumtech sincronizó: un MikroTik que ya estaba en
   * producción antes de darse de alta en el ERP, o tocado directo por
   * WinBox, puede tener VLANs reales que el ERP nunca supo que existían
   * (ver Plan_Implementacion_Descubrimiento_RouterOS_Brownfield.md Fase 1).
   */
  async scanRealVlans(nodeId: string): Promise<
    Array<{ vlanId: number; interfaceName: string; gatewayCidr: string | null; alreadyTracked: boolean }>
  > {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }

    const client = await this.resolveClient(node);
    const [realInterfaces, trackedRows] = await Promise.all([
      client.listVlanInterfaces(),
      this.nodeVlanRepository.find({ where: { nodeId }, relations: ['vlan'] }),
    ]);
    const trackedVlanNumbers = new Set(trackedRows.map((row) => row.vlan.vlanId));

    return Promise.all(
      realInterfaces.map(async (iface) => {
        const alreadyTracked = trackedVlanNumbers.has(iface.vlanId);
        let gatewayCidr: string | null = null;
        if (!alreadyTracked) {
          const ip = await client.findIpAddressByInterface(iface.name);
          gatewayCidr = ip?.address ?? null;
        }
        return {
          vlanId: iface.vlanId,
          interfaceName: iface.interface,
          gatewayCidr,
          alreadyTracked,
        };
      }),
    );
  }

  /**
   * Da de alta en Sumtech una VLAN que ya existe de verdad en el router
   * (descubierta por `scanRealVlans`) -- no escribe nada en RouterOS, solo
   * registra lo que ya estaba. Si el número de VLAN nunca existió en el
   * catálogo `net.vlans`, se crea un catálogo mínimo con nombre de
   * placeholder (mismo criterio ya aplicado al catálogo de Tipos de ONU:
   * mejor un placeholder editable que bloquear la importación).
   */
  async importDiscoveredVlan(
    nodeId: string,
    discovered: { vlanId: number; interfaceName: string; gatewayCidr?: string | null },
    actorUserId?: string,
  ): Promise<NetworkNodeVlanEntity> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }

    let vlan = await this.vlanRepository.findOneBy({ vlanId: discovered.vlanId });
    if (!vlan) {
      vlan = await this.vlanRepository.save(
        this.vlanRepository.create({
          vlanId: discovered.vlanId,
          name: `VLAN ${discovered.vlanId} (importada de ${node.name})`,
          type: 'INTERNET',
        }),
      );
    }

    const existing = await this.nodeVlanRepository.findOneBy({ nodeId, vlanId: vlan.id });
    if (existing) {
      throw new ConflictException(`La VLAN ${discovered.vlanId} ya está registrada para este nodo.`);
    }

    const record = this.nodeVlanRepository.create({
      nodeId,
      vlanId: vlan.id,
      uplinkInterface: discovered.interfaceName,
      gatewayCidr: discovered.gatewayCidr || undefined,
      applyStatus: 'APPLIED',
      lastSyncAt: new Date(),
    });
    await this.nodeVlanRepository.save(record);

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `VLAN ${discovered.vlanId} importada desde la configuración real de "${node.name}" (ya existía en el router, no se escribió nada nuevo).`,
      actorUserId,
      rawDetails: { nodeId: node.id, vlanId: vlan.id, operation: 'importDiscoveredVlan' },
    });

    return record;
  }

  /**
   * Revierte una sincronización de VLAN: borra la IP de gateway (si tenía) y
   * la sub-interfaz en RouterOS, y el registro local. Rechaza con 409 si la
   * interfaz todavía tiene un servidor PPPoE o DHCP asegurado encima -- eso
   * dejaría ese servidor apuntando a una interfaz inexistente en el router.
   */
  async desyncVlan(nodeId: string, vlanId: string, actorUserId?: string): Promise<void> {
    const nodeVlan = await this.nodeVlanRepository.findOne({ where: { nodeId, vlanId }, relations: ['vlan', 'node'] });
    if (!nodeVlan) {
      throw new NotFoundException(`No hay una VLAN sincronizada con id ${vlanId} para este nodo.`);
    }

    const node = nodeVlan.node || (await this.nodeRepository.findOneBy({ id: nodeId }))!;
    const interfaceName = `vlan${nodeVlan.vlan.vlanId}`;
    const client = await this.resolveClient(node);

    const [pppoeServer, dhcpServer] = await Promise.all([
      client.findPppoeServerByInterface(interfaceName),
      client.findDhcpServerByInterface(interfaceName),
    ]);
    if (pppoeServer || dhcpServer) {
      const found = [pppoeServer && 'servidor PPPoE', dhcpServer && 'servidor DHCP'].filter(Boolean).join(' y ');
      throw new ConflictException(
        `No se puede eliminar la VLAN ${nodeVlan.vlan.vlanId}: todavía tiene un ${found} asegurado sobre ${interfaceName}. Elimínalo primero en RouterOS.`,
      );
    }

    try {
      if (nodeVlan.gatewayCidr) {
        const ipAddress = await client.findIpAddressByInterface(interfaceName);
        if (ipAddress) {
          await client.removeIpAddress(ipAddress.id);
        }
      }

      const vlanInterface = await client.findVlanInterfaceByVlanId(nodeVlan.vlan.vlanId);
      if (vlanInterface) {
        await client.removeVlanInterface(vlanInterface.id);
      }

      await this.nodeVlanRepository.delete(nodeVlan.id);

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `VLAN ${nodeVlan.vlan.vlanId} (${nodeVlan.vlan.name}) des-sincronizada de "${node.name}".`,
        actorUserId,
        rawDetails: { nodeId: node.id, vlanId, interfaceName, operation: 'desyncVlan' },
      });
    } catch (err: any) {
      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'FAILURE',
        message: `Error des-sincronizando VLAN ${nodeVlan.vlan.vlanId} en "${node.name}": ${err.message}`,
        actorUserId,
        rawDetails: { nodeId: node.id, vlanId, interfaceName, operation: 'desyncVlan' },
      });
      throw err;
    }
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
   * Asegura el servidor PPPoE sobre la sub-interfaz VLAN ya sincronizada
   * en el router (ej. "vlan400"). Permite que los ONUs/routers clientes negocien
   * sesión PPPoE sobre esa VLAN.
   */
  async ensurePppoeServerForVlan(
    nodeId: string,
    vlanId: string,
    options?: EnsurePppoeServerForVlanOptions,
    actorUserId?: string,
  ): Promise<{ nodeVlan: NetworkNodeVlanEntity; server: any }> {
    const nodeVlan = await this.nodeVlanRepository.findOne({ where: { nodeId, vlanId }, relations: ['vlan', 'node'] });
    if (!nodeVlan) {
      throw new NotFoundException(
        `No hay una VLAN sincronizada para este nodo todavía — sincroniza primero la VLAN en el router.`,
      );
    }

    const node = nodeVlan.node || (await this.nodeRepository.findOneBy({ id: nodeId }))!;
    const interfaceName = `vlan${nodeVlan.vlan.vlanId}`;
    const serviceName = options?.serviceName || `pppoe-vlan${nodeVlan.vlan.vlanId}`;
    const defaultProfile = options?.defaultProfile || 'default';

    try {
      const client = await this.resolveClient(node);

      const server = await client.ensurePppoeServer({
        serviceName,
        interfaceName,
        defaultProfile,
        oneSessionPerHost: options?.oneSessionPerHost ?? true,
        authentication: options?.authentication,
      });

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Servidor PPPoE asegurado para VLAN ${nodeVlan.vlan.vlanId} en "${node.name}" sobre interfaz ${interfaceName}.`,
        actorUserId,
        rawDetails: { nodeId: node.id, vlanId, interfaceName, serviceName, operation: 'ensurePppoeServerForVlan' },
      });

      return { nodeVlan, server };
    } catch (err: any) {
      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'FAILURE',
        message: `Error asegurando servidor PPPoE para VLAN ${nodeVlan.vlan.vlanId} en "${node.name}": ${err.message}`,
        actorUserId,
        rawDetails: { nodeId: node.id, vlanId, interfaceName, operation: 'ensurePppoeServerForVlan' },
      });
      throw err;
    }
  }

  /**
   * Estado REAL de PPPoE/DHCP por cada VLAN ya registrada en Sumtech para
   * este nodo -- a diferencia de `ensurePppoeServerForVlan`/
   * `ensureDhcpServerForVlan`, que escriben a ciegas, esto es de solo
   * lectura: `findPppoeServerByInterface`/`findDhcpServerByInterface` ya
   * buscan por interfaz (no por un nombre específico de Sumtech), así que
   * detectan un servidor real aunque lo haya creado otra persona a mano
   * (ver Plan_Implementacion_Descubrimiento_RouterOS_Brownfield.md Fase 2).
   * Útil para que el admin vea lo que ya existe antes de pulsar "asegurar".
   */
  async getVlanServiceStatuses(nodeId: string): Promise<
    Array<{ vlanId: string; interfaceName: string; pppoe: { serviceName: string; defaultProfile: string } | null; dhcp: { name: string } | null }>
  > {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }

    const nodeVlans = await this.nodeVlanRepository.find({ where: { nodeId }, relations: ['vlan'] });
    const client = await this.resolveClient(node);

    return Promise.all(
      nodeVlans.map(async (nv) => {
        const interfaceName = `vlan${nv.vlan.vlanId}`;
        const [pppoe, dhcp] = await Promise.all([
          client.findPppoeServerByInterface(interfaceName),
          client.findDhcpServerByInterface(interfaceName),
        ]);
        return {
          vlanId: nv.vlanId,
          interfaceName,
          pppoe: pppoe ? { serviceName: pppoe.serviceName, defaultProfile: pppoe.defaultProfile } : null,
          dhcp: dhcp ? { name: dhcp.name } : null,
        };
      }),
    );
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

      node.natLastSyncAt = new Date();
      node.natLastSyncError = undefined;
      await this.nodeRepository.save(node);

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
      node.natLastSyncAt = new Date();
      node.natLastSyncError = err.message;
      await this.nodeRepository.save(node);

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

      node.firewallBaselineLastSyncAt = new Date();
      node.firewallBaselineLastSyncError = undefined;
      await this.nodeRepository.save(node);

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
      node.firewallBaselineLastSyncAt = new Date();
      node.firewallBaselineLastSyncError = err.message;
      await this.nodeRepository.save(node);

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
   * Reglas NAT reales en el router, SIN filtrar por el comentario que
   * Sumtech usa para sus propias reglas -- a propósito no se ofrece
   * "importar" nada aquí: una regla preexistente puede tener condiciones
   * (interfaz, dirección, protocolo) que `ensureNatMasquerade()` no
   * replica, así que solo se muestra para que el admin decida con
   * contexto completo antes de pulsar "Asegurar" (ver
   * Plan_Implementacion_Descubrimiento_RouterOS_Brownfield.md Fase 3).
   * Solo lectura, sin side-effects.
   */
  async getRealNatRules(nodeId: string) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    return client.listNatRules();
  }

  /**
   * Reglas de Filter reales en el router, sin filtrar por el comentario de
   * Sumtech -- mismo criterio que `getRealNatRules`: solo informativo, sin
   * botón de importar (el orden y las condiciones de una regla de firewall
   * preexistente tienen implicaciones de seguridad que no se pueden inferir
   * con seguridad desde aquí).
   */
  async getRealFirewallRules(nodeId: string) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    return client.listFilterRules();
  }

  /**
   * Reconciliación de solo lectura: confirma contra el router real si lo que
   * Postgres cree aplicado (VLANs sincronizadas, NAT masquerade, firewall
   * baseline) sigue existiendo de verdad -- cubre el caso de que alguien
   * haya tocado el MikroTik a mano por WinBox por fuera del ERP. No escribe
   * nada, no dispara DeviceOperationLogger (igual que getIpAddresses()).
   */
  async getReconciliationStatus(nodeId: string): Promise<{
    vlans: Array<{ vlanId: string; vlanNumber: number; existsInRouter: boolean; gatewayMatches: boolean | null }>;
    nat: boolean;
    firewall: boolean;
  }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    const nodeVlans = await this.nodeVlanRepository.find({ where: { nodeId }, relations: ['vlan'] });

    const vlans = await Promise.all(
      nodeVlans.map(async (nv) => {
        const vlanInterface = await client.findVlanInterfaceByVlanId(nv.vlan.vlanId);
        let gatewayMatches: boolean | null = null;
        if (vlanInterface && nv.gatewayCidr) {
          const ip = await client.findIpAddressByInterface(`vlan${nv.vlan.vlanId}`);
          gatewayMatches = Boolean(ip && ip.address === nv.gatewayCidr);
        }
        return {
          vlanId: nv.vlanId,
          vlanNumber: nv.vlan.vlanId,
          existsInRouter: Boolean(vlanInterface),
          gatewayMatches,
        };
      }),
    );

    const [natRule, filterRules] = await Promise.all([
      client.findNatRuleByComment('sumtech-nat-masquerade'),
      Promise.all([
        client.findFilterRuleByComment('sumtech-baseline-established'),
        client.findFilterRuleByComment('sumtech-baseline-drop-invalid'),
      ]),
    ]);

    return {
      vlans,
      nat: Boolean(natRule),
      firewall: filterRules.every(Boolean),
    };
  }

  /**
   * Lista las IPs reales configuradas en el router (diagnóstico de topología:
   * ej. confirmar el gateway real de una LAN antes de registrar una Red
   * TR-069, en vez de asumirlo). Solo lectura, sin side-effects.
   */
  async getIpAddresses(nodeId: string) {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo de red no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    return client.getIpAddresses();
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

  // --- FASE 2: RESPALDOS Y ACTUALIZACIONES ROUTEROS ---

  async generateAndDownloadBackup(
    nodeId: string,
    options: { type: 'BINARY' | 'RSC'; password?: string },
    actorUserId?: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    const client = await this.resolveClient(node);
    const safeNodeName = (node.name || 'node').replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `sumtech_${safeNodeName}_${timestamp}`;

    let targetFileName = '';
    let contentType = 'application/octet-stream';

    if (options.type === 'BINARY') {
      targetFileName = await client.createBackup(baseName, options.password);
      contentType = 'application/octet-stream';
    } else {
      targetFileName = await client.exportConfig(baseName, true);
      contentType = 'text/plain; charset=utf-8';
    }

    try {
      const buffer = await client.readFileChunks(targetFileName);

      // Limpieza inmediata en el router para evitar llenar la flash
      await client.deleteFile(targetFileName).catch(() => {});

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Respaldo ${options.type} (${targetFileName}) generado y descargado para "${node.name}".`,
        actorUserId,
        rawDetails: { operation: 'generateAndDownloadBackup', type: options.type, filename: targetFileName },
      });

      return {
        buffer,
        filename: targetFileName,
        contentType,
      };
    } catch (error: any) {
      await client.deleteFile(targetFileName).catch(() => {});
      throw error;
    }
  }

  async getRouterOsUpdates(nodeId: string): Promise<RouterOsUpdateInfo> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    return client.checkPackageUpdates();
  }

  // --- FASE 3: INTERFACES FÍSICAS Y LEASES DHCP ---

  async getInterfaces(nodeId: string): Promise<RouterOsInterfaceItem[]> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    return client.getInterfaces();
  }

  async setInterfaceDisabled(
    nodeId: string,
    name: string,
    disabled: boolean,
    actorUserId?: string,
  ): Promise<{ ok: boolean }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    // Guard de seguridad: no permitir deshabilitar la interfaz WAN configurada
    if (disabled && node.wanInterfaceName && name.toLowerCase() === node.wanInterfaceName.toLowerCase()) {
      throw new BadRequestException(`No se puede deshabilitar la interfaz WAN activa ("${name}").`);
    }

    const client = await this.resolveClient(node);
    await client.setInterfaceDisabled(name, disabled);

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Interfaz "${name}" ${disabled ? 'deshabilitada' : 'habilitada'} en "${node.name}".`,
      actorUserId,
      rawDetails: { operation: 'setInterfaceDisabled', interface: name, disabled },
    });

    return { ok: true };
  }

  async getDhcpLeases(nodeId: string): Promise<RouterOsDhcpLease[]> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    return client.getDhcpLeases();
  }

  async makeDhcpLeaseStatic(
    nodeId: string,
    leaseId: string,
    comment?: string,
    actorUserId?: string,
  ): Promise<{ ok: boolean }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    await client.makeDhcpLeaseStatic(leaseId, comment);

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Concesión DHCP "${leaseId}" convertida a estática en "${node.name}".`,
      actorUserId,
      rawDetails: { operation: 'makeDhcpLeaseStatic', leaseId, comment },
    });

    return { ok: true };
  }

  async deleteDhcpLease(
    nodeId: string,
    leaseId: string,
    actorUserId?: string,
  ): Promise<{ ok: boolean }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    await client.deleteDhcpLease(leaseId);

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Concesión DHCP "${leaseId}" eliminada de "${node.name}".`,
      actorUserId,
      rawDetails: { operation: 'deleteDhcpLease', leaseId },
    });

    return { ok: true };
  }

  // --- FASE 4: ANCHO DE BANDA AVANZADO (SIMPLE QUEUES) ---

  async getSimpleQueues(nodeId: string): Promise<RouterOsSimpleQueue[]> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    return client.getSimpleQueues();
  }

  // --- FASE 5: SEGURIDAD, PLANTILLAS FIREWALL Y LOGS EN VIVO ---

  async applySecurityLockdown(
    nodeId: string,
    allowedIps: string[] = [],
    actorUserId?: string,
  ): Promise<{ ok: boolean }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    const client = await this.resolveClient(node);

    // Lista blanca segura: incluye Wireguard (10.254.1.0/24), la IP de gestión del nodo y las solicitadas
    const safeIps = new Set<string>(['10.254.1.0/24']);
    if (node.managementIp) {
      safeIps.add(`${node.managementIp}/32`);
    }
    for (const ip of allowedIps) {
      if (ip && ip.trim()) safeIps.add(ip.trim());
    }

    for (const ip of safeIps) {
      await client.ensureAddressListEntry('sumtech-management-ips', ip, 'Sumtech Management Protected');
    }

    // Regla drop para puertos de gestión si la fuente NO está en sumtech-management-ips
    const existingRule = await client.findFilterRuleByComment('sumtech-lockdown-management');
    if (!existingRule) {
      await client.addFirewallFilterRule({
        chain: 'input',
        protocol: 'tcp',
        'dst-port': '22,80,443,8728,8729,8291',
        'src-address-list': '!sumtech-management-ips',
        action: 'drop',
        comment: 'sumtech-lockdown-management',
      });
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Bloqueo de seguridad de puertos de administración aplicado en "${node.name}".`,
      actorUserId,
      rawDetails: { operation: 'applySecurityLockdown', allowedIps: Array.from(safeIps) },
    });

    return { ok: true };
  }

  async removeSecurityLockdown(nodeId: string, actorUserId?: string): Promise<{ ok: boolean }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    await client.removeFilterRulesByComment('sumtech-lockdown-management');
    await client.removeAddressListEntriesByComment('Sumtech Management Protected');

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Bloqueo de puertos de administración removido de "${node.name}".`,
      actorUserId,
      rawDetails: { operation: 'removeSecurityLockdown' },
    });

    return { ok: true };
  }

  async applyAntiAbuseTemplate(
    nodeId: string,
    template: 'BLOCK_SMTP_PORT25' | 'CLIENT_ISOLATION',
    enabled: boolean,
    actorUserId?: string,
  ): Promise<{ ok: boolean }> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);

    if (template === 'BLOCK_SMTP_PORT25') {
      const comment = 'sumtech-block-smtp-port25';
      if (enabled) {
        const existing = await client.findFilterRuleByComment(comment);
        if (!existing) {
          await client.addFirewallFilterRule({
            chain: 'forward',
            protocol: 'tcp',
            'dst-port': '25',
            action: 'drop',
            comment,
          });
        }
      } else {
        await client.removeFilterRulesByComment(comment);
      }
    } else if (template === 'CLIENT_ISOLATION') {
      const comment = 'sumtech-client-isolation';
      if (enabled) {
        const existing = await client.findFilterRuleByComment(comment);
        if (!existing) {
          await client.addFirewallFilterRule({
            chain: 'forward',
            'in-interface-list': 'LAN',
            'out-interface-list': 'LAN',
            action: 'drop',
            comment,
          });
        }
      } else {
        await client.removeFilterRulesByComment(comment);
      }
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: node.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Plantilla "${template}" ${enabled ? 'activada' : 'desactivada'} en "${node.name}".`,
      actorUserId,
      rawDetails: { operation: 'applyAntiAbuseTemplate', template, enabled },
    });

    return { ok: true };
  }

  async getRouterOsLogs(nodeId: string, topics?: string): Promise<RouterOsLogEntry[]> {
    const node = await this.nodeRepository.findOneBy({ id: nodeId });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }
    const client = await this.resolveClient(node);
    return client.getRouterLogs(topics);
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
