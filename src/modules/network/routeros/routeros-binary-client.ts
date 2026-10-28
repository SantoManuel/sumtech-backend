import { BadRequestException } from '@nestjs/common';
import { RouterOsClientLike } from './routeros-client-factory';
import {
  RouterOsClientConfig,
  RouterOsConnectionResult,
  RouterOsPppSecret,
  CreatePppSecretOptions,
  RouterOsPppProfile,
  EnsureProfileOptions,
  RouterOsIpPool,
  RouterOsActivePppSession,
  RouterOsVlanInterface,
  EnsureVlanInterfaceOptions,
  RouterOsIpAddress,
  RouterOsDhcpClient,
  RouterOsPppoeClient,
  EnsurePppoeClientOptions,
  RouterOsRoute,
  RouterOsNatRule,
  RouterOsFilterRule,
  RouterOsDhcpServer,
  RouterOsPppoeServer,
  EnsurePppoeServerOptions,
  RouterOsDhcpLease,
  RouterOsSimpleQueue,
  RouterOsDhcpMatcher,
  RouterOsUpdateInfo,
  RouterOsInterfaceItem,
  RouterOsLogEntry,
} from './routeros-client';

// node-routeros exporta RouterOSAPI -- mismo patrón de import que
// RouterOsBinaryTransport (network-connectivity), ya probado en producción
// contra la flota real para monitoreo.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RouterOSAPI } = require('node-routeros');

const DEFAULT_TIMEOUT_SEC = 8;

/**
 * Cliente contra la API BINARIA de RouterOS (puerto 8728/8729, protocolo
 * propietario MikroTik desde RouterOS v3) -- implementa la MISMA interfaz
 * `RouterOsClientLike` que `RouterOsClient` (REST), para que
 * `RouterOsClientResolverService` pueda intercambiarlos según
 * `node.transportType` sin que `NetworkNodeInfrastructureService` ni
 * `PppManagementService` sepan la diferencia.
 *
 * Los nombres de campo que devuelve RouterOS son IDÉNTICOS entre REST y la
 * API binaria (`.id`, `name`, `running`, `remote-address`, etc. -- la REST
 * API es literalmente un envoltorio JSON sobre la misma estructura de
 * comandos/respuestas del protocolo binario), así que el mapeo de cada
 * método reutiliza exactamente la misma lógica que su equivalente en
 * `RouterOsClient`, solo cambiando `this.http.get(...)` por
 * `conn.write('/ruta/print', [...filtros])`.
 *
 * Alcance de esta primera versión (Plan_Implementacion_Soporte_API_Binaria_SSH.md,
 * Fase 1 Lote A): los métodos de SOLO LECTURA que ya eran el problema
 * reportado (getInterfaces/getIpPools y el resto de listados usados por
 * NodeFormModal/NodeInfrastructureModal) están completamente implementados.
 * El resto de la interfaz (Lote B: creación/edición/borrado de VLANs, PPP,
 * DHCP, NAT, firewall, rutas, colas, backups) lanza un error explícito y
 * tipado en vez de fallar en silencio o corromper datos -- es una frontera
 * de alcance deliberada, no un olvido: ver `unsupportedOperation()` abajo.
 */
export class RouterOsBinaryClient implements RouterOsClientLike {
  constructor(private readonly config: RouterOsClientConfig) {}

  // --- Infraestructura de conexión ---

  private async withConnection<T>(fn: (conn: any) => Promise<T>): Promise<T> {
    const timeoutSec = this.config.timeoutMs
      ? Math.max(1, Math.round(this.config.timeoutMs / 1000))
      : DEFAULT_TIMEOUT_SEC;

    const conn = new RouterOSAPI({
      host: this.config.managementIp,
      user: this.config.username,
      password: this.config.password,
      port: this.config.apiPort,
      timeout: timeoutSec,
    });

    try {
      await conn.connect();
      return await fn(conn);
    } catch (error) {
      throw new Error(this.describeError(error));
    } finally {
      try {
        await conn.close();
      } catch {
        // Ignorar error al cerrar el socket -- ya se reportó (o no) el error real arriba.
      }
    }
  }

  private describeError(error: any): string {
    const message: string = error?.message || '';
    if (/timeout/i.test(message) || error?.code === 'ETIMEDOUT') {
      return 'Tiempo de espera agotado contactando al nodo.';
    }
    if (/ECONNREFUSED/i.test(message) || error?.code === 'ECONNREFUSED') {
      return 'No se pudo contactar al nodo (conexión rechazada) — revisa managementIp/apiPort y que el servicio "api" esté habilitado en /ip/service.';
    }
    if (/ECONNRESET/i.test(message) || error?.code === 'ECONNRESET') {
      return 'El nodo cerró la conexión abruptamente — revisa que el puerto configurado sea el de la API binaria (api/api-ssl), no el de REST (www/www-ssl).';
    }
    if (error?.errno) {
      // RosException: errores reportados por el propio RouterOS (ej. "no such item", "already have such address").
      return `El nodo respondió con error: ${message || error.errno}`;
    }
    return message || 'Error desconocido consultando el nodo.';
  }

  private unsupportedOperation(methodName: string): BadRequestException {
    return new BadRequestException(
      `La operación "${methodName}" todavía no está implementada para el transporte API Binaria en este nodo. ` +
        'Cambia el Protocolo del nodo a REST para usarla, o agrega soporte binario ' +
        '(ver Plan_Implementacion_Soporte_API_Binaria_SSH.md, Fase 1 Lote B).',
    );
  }

  private mapPppoeServerEntry(entry: any): RouterOsPppoeServer {
    return {
      id: entry['.id'],
      serviceName: entry['service-name'] || entry.name || '',
      interface: entry.interface,
      defaultProfile: entry['default-profile'] || 'default',
      disabled: entry.disabled === true || entry.disabled === 'true',
      oneSessionPerHost:
        entry['one-session-per-host'] === true ||
        entry['one-session-per-host'] === 'yes' ||
        entry['one-session-per-host'] === 'true',
      authentication: entry.authentication,
    };
  }

  // --- Lote A: lectura (completamente implementado) ---

  async testConnection(): Promise<RouterOsConnectionResult> {
    try {
      await this.withConnection((conn) => conn.write('/system/identity/print'));
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error desconocido consultando el nodo.' };
    }
  }

  async getProfiles(): Promise<RouterOsPppProfile[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/ppp/profile/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'],
        name: entry.name,
        rateLimit: entry['rate-limit'],
        parentQueue: entry['parent-queue'],
        localAddress: entry['local-address'],
        remoteAddress: entry['remote-address'],
        onlyOne:
          entry['only-one'] !== undefined ? entry['only-one'] === true || entry['only-one'] === 'yes' : undefined,
        dnsServer: entry['dns-server'],
      }));
    });
  }

  async getIpPools(): Promise<RouterOsIpPool[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/ip/pool/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'],
        name: entry.name,
        ranges: entry.ranges,
        nextPool: entry['next-pool'],
      }));
    });
  }

  async getUsedPoolAddresses(poolName: string): Promise<string[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/ip/pool/used/print', [`?pool=${poolName}`]);
      return (Array.isArray(results) ? results : [])
        .map((entry: any) => (typeof entry.address === 'string' ? entry.address.split('/')[0] : undefined))
        .filter((ip: string | undefined): ip is string => Boolean(ip));
    });
  }

  async getPppSecrets(): Promise<RouterOsPppSecret[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/ppp/secret/print');
      return (Array.isArray(results) ? results : []).map((match: any) => ({
        id: match['.id'],
        name: match.name,
        disabled: match.disabled === true || match.disabled === 'true',
        profile: match.profile,
        service: match.service,
        remoteAddress: match['remote-address'],
        comment: match.comment,
      }));
    });
  }

  async getActiveSessions(): Promise<RouterOsActivePppSession[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/ppp/active/print');
      return (Array.isArray(results) ? results : []).map((s: any) => ({
        id: s['.id'],
        name: s.name,
        service: s.service,
        callerId: s['caller-id'],
        address: s.address,
        uptime: s.uptime,
        encoding: s.encoding,
        sessionId: s['session-id'],
      }));
    });
  }

  async listVlanInterfaces(): Promise<RouterOsVlanInterface[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/interface/vlan/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'],
        name: entry.name,
        vlanId: Number(entry['vlan-id']),
        interface: entry.interface,
      }));
    });
  }

  async getIpAddresses(): Promise<RouterOsIpAddress[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/ip/address/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'],
        address: entry.address,
        interface: entry.interface,
        comment: entry.comment,
      }));
    });
  }

  async listDhcpServers(): Promise<RouterOsDhcpServer[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/ip/dhcp-server/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'],
        name: entry.name,
        interface: entry.interface,
        addressPool: entry['address-pool'],
        disabled: entry.disabled === true || entry.disabled === 'true',
      }));
    });
  }

  async listPppoeServers(): Promise<RouterOsPppoeServer[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/interface/pppoe-server/server/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => this.mapPppoeServerEntry(entry));
    });
  }

  async listNatRules(): Promise<RouterOsNatRule[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/ip/firewall/nat/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'],
        chain: entry.chain,
        action: entry.action,
        outInterface: entry['out-interface'],
        comment: entry.comment,
        disabled: entry.disabled === true || entry.disabled === 'true',
      }));
    });
  }

  async listFilterRules(): Promise<RouterOsFilterRule[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/ip/firewall/filter/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'],
        chain: entry.chain,
        action: entry.action,
        connectionState: entry['connection-state'],
        comment: entry.comment,
        disabled: entry.disabled === true || entry.disabled === 'true',
      }));
    });
  }

  async getInterfaces(): Promise<RouterOsInterfaceItem[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/interface/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'] || '',
        name: entry.name || '',
        type: entry.type || 'ether',
        running: entry.running === true || entry.running === 'true',
        disabled: entry.disabled === true || entry.disabled === 'true',
        macAddress: entry['mac-address'],
        mtu: entry.mtu ? parseInt(entry.mtu, 10) : undefined,
        comment: entry.comment,
      }));
    });
  }

  async getDhcpLeases(): Promise<RouterOsDhcpLease[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/ip/dhcp-server/lease/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'] || '',
        address: entry.address || '',
        macAddress: entry['mac-address'] || '',
        server: entry.server || '',
        hostName: entry['host-name'],
        status: entry.status || (entry.dynamic === true || entry.dynamic === 'true' ? 'bound' : 'static'),
        dynamic: entry.dynamic === true || entry.dynamic === 'true',
        disabled: entry.disabled === true || entry.disabled === 'true',
        comment: entry.comment,
        lastSeen: entry['last-seen'],
      }));
    });
  }

  async getSimpleQueues(): Promise<RouterOsSimpleQueue[]> {
    return this.withConnection(async (conn) => {
      const results = await conn.write('/queue/simple/print');
      return (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'] || '',
        name: entry.name || '',
        target: entry.target || '',
        maxLimit: entry['max-limit'] || '',
        rate: entry.rate,
        bytes: entry.bytes,
        packets: entry.packets,
        disabled: entry.disabled === true || entry.disabled === 'true',
        comment: entry.comment,
      }));
    });
  }

  async getRouterLogs(topics?: string): Promise<RouterOsLogEntry[]> {
    return this.withConnection(async (conn) => {
      const params = topics ? [`?topics=${topics}`] : [];
      const results = await conn.write('/log/print', params);
      const mapped = (Array.isArray(results) ? results : []).map((entry: any) => ({
        id: entry['.id'] || '',
        time: entry.time || '',
        topics: entry.topics || '',
        message: entry.message || '',
      }));
      return mapped.slice(-150).reverse();
    });
  }

  // --- Lote B / C: escritura, mutación y transferencia de archivos ---
  //
  // Deliberadamente NO implementados todavía (ver cabecera de este archivo y
  // Plan_Implementacion_Soporte_API_Binaria_SSH.md). Cada uno lanza
  // `unsupportedOperation()` con un mensaje claro en vez de fallar en
  // silencio, devolver datos incorrectos, o -- peor -- ejecutar una mutación
  // a medio probar contra un router de producción.

  async findPppSecretByName(name: string): Promise<RouterOsPppSecret | null> {
    throw this.unsupportedOperation('findPppSecretByName');
  }

  async createPppSecret(options: CreatePppSecretOptions): Promise<RouterOsPppSecret> {
    throw this.unsupportedOperation('createPppSecret');
  }

  async ensurePppSecret(options: CreatePppSecretOptions): Promise<RouterOsPppSecret> {
    throw this.unsupportedOperation('ensurePppSecret');
  }

  async setPppSecretDisabled(secretId: string, disabled: boolean): Promise<void> {
    throw this.unsupportedOperation('setPppSecretDisabled');
  }

  async setPppSecretProfile(secretId: string, profileName: string): Promise<void> {
    throw this.unsupportedOperation('setPppSecretProfile');
  }

  async findProfileByName(name: string): Promise<RouterOsPppProfile | null> {
    throw this.unsupportedOperation('findProfileByName');
  }

  async createProfile(name: string, rateLimit: string, options?: EnsureProfileOptions): Promise<RouterOsPppProfile> {
    throw this.unsupportedOperation('createProfile');
  }

  async updateProfile(profileId: string, rateLimit?: string, options?: EnsureProfileOptions): Promise<void> {
    throw this.unsupportedOperation('updateProfile');
  }

  async ensureProfile(name: string, rateLimit: string, options?: EnsureProfileOptions): Promise<RouterOsPppProfile> {
    throw this.unsupportedOperation('ensureProfile');
  }

  async ensureSuspensionProfile(profileName?: string, rateLimit?: string): Promise<RouterOsPppProfile> {
    throw this.unsupportedOperation('ensureSuspensionProfile');
  }

  async deleteProfile(profileId: string): Promise<void> {
    throw this.unsupportedOperation('deleteProfile');
  }

  async findActiveSessionByName(username: string): Promise<RouterOsActivePppSession | null> {
    throw this.unsupportedOperation('findActiveSessionByName');
  }

  async killActiveSession(username: string): Promise<boolean> {
    throw this.unsupportedOperation('killActiveSession');
  }

  async addAddressListEntry(list: string, address: string, comment?: string): Promise<void> {
    throw this.unsupportedOperation('addAddressListEntry');
  }

  async removeAddressListEntry(list: string, address: string): Promise<void> {
    throw this.unsupportedOperation('removeAddressListEntry');
  }

  async addFirewallNatRule(rule: Record<string, string>): Promise<void> {
    throw this.unsupportedOperation('addFirewallNatRule');
  }

  async addFirewallFilterRule(rule: Record<string, string>): Promise<void> {
    throw this.unsupportedOperation('addFirewallFilterRule');
  }

  async findVlanInterfaceByVlanId(vlanId: number): Promise<RouterOsVlanInterface | null> {
    throw this.unsupportedOperation('findVlanInterfaceByVlanId');
  }

  async ensureVlanInterface(options: EnsureVlanInterfaceOptions): Promise<RouterOsVlanInterface> {
    throw this.unsupportedOperation('ensureVlanInterface');
  }

  async findIpAddressByInterface(interfaceName: string): Promise<RouterOsIpAddress | null> {
    throw this.unsupportedOperation('findIpAddressByInterface');
  }

  async ensureIpAddress(
    interfaceName: string,
    address: string,
    comment?: string,
    allowReplace?: boolean,
  ): Promise<RouterOsIpAddress> {
    throw this.unsupportedOperation('ensureIpAddress');
  }

  async removeIpAddress(addressId: string): Promise<void> {
    throw this.unsupportedOperation('removeIpAddress');
  }

  async removeVlanInterface(vlanInterfaceId: string): Promise<void> {
    throw this.unsupportedOperation('removeVlanInterface');
  }

  async findDhcpClientByInterface(interfaceName: string): Promise<RouterOsDhcpClient | null> {
    throw this.unsupportedOperation('findDhcpClientByInterface');
  }

  async ensureDhcpClient(interfaceName: string, addDefaultRoute?: boolean): Promise<RouterOsDhcpClient> {
    throw this.unsupportedOperation('ensureDhcpClient');
  }

  async findPppoeClientByName(name: string): Promise<RouterOsPppoeClient | null> {
    throw this.unsupportedOperation('findPppoeClientByName');
  }

  async ensurePppoeClient(options: EnsurePppoeClientOptions): Promise<RouterOsPppoeClient> {
    throw this.unsupportedOperation('ensurePppoeClient');
  }

  async findRouteByDestination(dstAddress: string): Promise<RouterOsRoute | null> {
    throw this.unsupportedOperation('findRouteByDestination');
  }

  async ensureDefaultRoute(gateway: string, comment?: string): Promise<RouterOsRoute> {
    throw this.unsupportedOperation('ensureDefaultRoute');
  }

  async ensureNatMasquerade(outInterface: string, comment?: string): Promise<void> {
    throw this.unsupportedOperation('ensureNatMasquerade');
  }

  async findNatRuleByComment(comment: string): Promise<{ id: string } | null> {
    throw this.unsupportedOperation('findNatRuleByComment');
  }

  async ensureFirewallBaseline(): Promise<void> {
    throw this.unsupportedOperation('ensureFirewallBaseline');
  }

  async findFilterRuleByComment(comment: string): Promise<{ id: string } | null> {
    throw this.unsupportedOperation('findFilterRuleByComment');
  }

  async findIpPoolByName(name: string): Promise<{ id: string; name: string; ranges: string } | null> {
    throw this.unsupportedOperation('findIpPoolByName');
  }

  async ensureIpPool(name: string, ranges: string): Promise<{ id: string; name: string; ranges: string }> {
    throw this.unsupportedOperation('ensureIpPool');
  }

  async findDhcpServerNetworkByAddress(addressCidr: string): Promise<{ id: string } | null> {
    throw this.unsupportedOperation('findDhcpServerNetworkByAddress');
  }

  async ensureDhcpServerNetwork(addressCidr: string, gateway: string, dnsServers?: string): Promise<void> {
    throw this.unsupportedOperation('ensureDhcpServerNetwork');
  }

  async findDhcpServerByInterface(
    interfaceName: string,
  ): Promise<{ id: string; name: string; addressPool?: string } | null> {
    throw this.unsupportedOperation('findDhcpServerByInterface');
  }

  async ensureDhcpServer(
    name: string,
    interfaceName: string,
    addressPool: string,
    leaseTimeSec?: number,
  ): Promise<{ id: string; name: string }> {
    throw this.unsupportedOperation('ensureDhcpServer');
  }

  async findStaticLeaseByMac(macAddress: string): Promise<RouterOsDhcpLease | null> {
    throw this.unsupportedOperation('findStaticLeaseByMac');
  }

  async ensureStaticLease(
    macAddress: string,
    address: string,
    server: string,
    comment?: string,
  ): Promise<RouterOsDhcpLease> {
    throw this.unsupportedOperation('ensureStaticLease');
  }

  async setLeaseDisabled(leaseId: string, disabled: boolean): Promise<void> {
    throw this.unsupportedOperation('setLeaseDisabled');
  }

  async findSimpleQueueByName(name: string): Promise<RouterOsSimpleQueue | null> {
    throw this.unsupportedOperation('findSimpleQueueByName');
  }

  async ensureSimpleQueue(name: string, target: string, maxLimit: string): Promise<RouterOsSimpleQueue> {
    throw this.unsupportedOperation('ensureSimpleQueue');
  }

  async setSimpleQueueDisabled(queueId: string, disabled: boolean): Promise<void> {
    throw this.unsupportedOperation('setSimpleQueueDisabled');
  }

  async ensureAcsAutoProvisioning(
    acsUrl: string,
    namePrefix?: string,
    server?: 'all' | string,
  ): Promise<RouterOsDhcpMatcher> {
    throw this.unsupportedOperation('ensureAcsAutoProvisioning');
  }

  async findPppoeServerByInterface(interfaceName: string): Promise<RouterOsPppoeServer | null> {
    throw this.unsupportedOperation('findPppoeServerByInterface');
  }

  async ensurePppoeServer(options: EnsurePppoeServerOptions): Promise<RouterOsPppoeServer> {
    throw this.unsupportedOperation('ensurePppoeServer');
  }

  async createBackup(name: string, password?: string): Promise<string> {
    throw this.unsupportedOperation('createBackup');
  }

  async exportConfig(file: string, showSensitive?: boolean): Promise<string> {
    throw this.unsupportedOperation('exportConfig');
  }

  async readFileChunks(filename: string): Promise<Buffer> {
    throw this.unsupportedOperation('readFileChunks');
  }

  async deleteFile(filename: string): Promise<void> {
    throw this.unsupportedOperation('deleteFile');
  }

  async checkPackageUpdates(): Promise<RouterOsUpdateInfo> {
    throw this.unsupportedOperation('checkPackageUpdates');
  }

  async setInterfaceDisabled(nameOrId: string, disabled: boolean): Promise<void> {
    throw this.unsupportedOperation('setInterfaceDisabled');
  }

  async createIpPool(name: string, ranges: string): Promise<RouterOsIpPool> {
    throw this.unsupportedOperation('createIpPool');
  }

  async updateIpPool(id: string, ranges: string): Promise<RouterOsIpPool> {
    throw this.unsupportedOperation('updateIpPool');
  }

  async deleteIpPool(id: string): Promise<void> {
    throw this.unsupportedOperation('deleteIpPool');
  }

  async makeDhcpLeaseStatic(leaseId: string, comment?: string): Promise<void> {
    throw this.unsupportedOperation('makeDhcpLeaseStatic');
  }

  async deleteDhcpLease(leaseId: string): Promise<void> {
    throw this.unsupportedOperation('deleteDhcpLease');
  }

  async ensureAddressListEntry(list: string, address: string, comment?: string): Promise<void> {
    throw this.unsupportedOperation('ensureAddressListEntry');
  }

  async removeAddressListEntriesByComment(comment: string): Promise<void> {
    throw this.unsupportedOperation('removeAddressListEntriesByComment');
  }

  async removeFilterRulesByComment(comment: string): Promise<void> {
    throw this.unsupportedOperation('removeFilterRulesByComment');
  }
}
