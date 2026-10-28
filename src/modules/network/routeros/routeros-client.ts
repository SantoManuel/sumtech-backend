import axios, { AxiosInstance } from 'axios';
import * as https from 'https';

export interface RouterOsClientConfig {
  managementIp: string;
  apiPort: number;
  username: string;
  password: string;
  /** default true — los Mikrotik en campo casi siempre exponen la REST API por HTTPS con certificado autofirmado. */
  useHttps?: boolean;
  timeoutMs?: number;
}

export interface RouterOsPppSecret {
  /** El ".id" interno de RouterOS (ej. "*1") — necesario para poder hacer PATCH sobre este secreto puntual. */
  id: string;
  name: string;
  disabled: boolean;
  profile?: string;
  service?: string;
  remoteAddress?: string;
  comment?: string;
}

export interface RouterOsPppProfile {
  /** El ".id" interno de RouterOS (ej. "*1") — necesario para poder hacer PATCH sobre este perfil puntual. */
  id: string;
  name: string;
  /** Formato RouterOS "rx-rate/tx-rate", ej. "50M/50M". */
  rateLimit?: string;
  parentQueue?: string;
  localAddress?: string;
  remoteAddress?: string;
  onlyOne?: boolean;
  /** Servidores DNS entregados al cliente por IPCP, formato RouterOS "8.8.8.8,1.1.1.1". Sin esto el cliente PPPoE no puede resolver nombres de dominio (ej. para TR-069/ACS). */
  dnsServer?: string;
}

export interface RouterOsIpPool {
  id: string;
  name: string;
  ranges: string;
  nextPool?: string;
}

export interface RouterOsActivePppSession {
  id: string;
  name: string;
  service: string;
  callerId?: string;
  address?: string;
  uptime?: string;
  encoding?: string;
  sessionId?: string;
}

export interface CreatePppSecretOptions {
  name: string;
  password?: string;
  profile: string;
  service?: string;
  remoteAddress?: string;
  localAddress?: string;
  comment?: string;
  disabled?: boolean;
}

export interface EnsureProfileOptions {
  parentQueue?: string;
  localAddress?: string;
  remoteAddress?: string;
  onlyOne?: boolean;
  dnsServer?: string;
}

export interface RouterOsConnectionResult {
  ok: boolean;
  error?: string;
}

export interface RouterOsVlanInterface {
  /** El ".id" interno de RouterOS (ej. "*1"). */
  id: string;
  name: string;
  vlanId: number;
  interface: string;
}

export interface EnsureVlanInterfaceOptions {
  /** Nombre de la sub-interfaz a crear, ej. "vlan400-clientes". */
  name: string;
  vlanId: number;
  /** Interfaz física (o bridge) sobre la que corre la VLAN, ej. "ether5". */
  parentInterface: string;
  comment?: string;
}

export interface RouterOsIpAddress {
  id: string;
  address: string;
  interface: string;
  comment?: string;
}

export interface RouterOsDhcpClient {
  id: string;
  interface: string;
  disabled: boolean;
}

export interface RouterOsPppoeClient {
  id: string;
  name: string;
  interface: string;
  user?: string;
  disabled: boolean;
}

export interface EnsurePppoeClientOptions {
  name: string;
  parentInterface: string;
  user: string;
  password: string;
  addDefaultRoute?: boolean;
}

export interface RouterOsPppoeServer {
  id: string;
  serviceName: string;
  interface: string;
  defaultProfile: string;
  disabled: boolean;
  oneSessionPerHost?: boolean;
  authentication?: string;
}

export interface EnsurePppoeServerOptions {
  serviceName?: string;
  interfaceName: string;
  defaultProfile?: string;
  oneSessionPerHost?: boolean;
  authentication?: string;
}

export interface RouterOsRoute {
  id: string;
  dstAddress: string;
  gateway: string;
  comment?: string;
}

/** Fila cruda de /ip/firewall/nat -- usada por listNatRules() (descubrimiento, solo lectura). */
export interface RouterOsNatRule {
  id: string;
  chain: string;
  action: string;
  outInterface?: string;
  comment?: string;
  disabled: boolean;
}

/** Fila cruda de /ip/firewall/filter -- usada por listFilterRules() (descubrimiento, solo lectura). */
export interface RouterOsFilterRule {
  id: string;
  chain: string;
  action: string;
  connectionState?: string;
  comment?: string;
  disabled: boolean;
}

/** Fila cruda de /ip/dhcp-server -- usada por listDhcpServers() (descubrimiento, solo lectura). */
export interface RouterOsDhcpServer {
  id: string;
  name: string;
  interface: string;
  addressPool?: string;
  disabled: boolean;
}

export interface RouterOsDhcpLease {
  id: string;
  address: string;
  macAddress: string;
  server: string;
  hostName?: string;
  status?: string;
  dynamic?: boolean;
  disabled: boolean;
  comment?: string;
  lastSeen?: string;
}

export interface RouterOsSimpleQueue {
  id: string;
  name: string;
  target: string;
  maxLimit: string;
  rate?: string;
  bytes?: string;
  packets?: string;
  disabled: boolean;
  comment?: string;
}

export interface RouterOsUpdateInfo {
  channel: string;
  installedVersion: string;
  latestVersion: string;
  status: string;
  updateAvailable: boolean;
}

export interface RouterOsInterfaceItem {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  macAddress?: string;
  mtu?: number;
  comment?: string;
}

export interface RouterOsLogEntry {
  id: string;
  time: string;
  topics: string;
  message: string;
}

export interface RouterOsDhcpOption {
  id: string;
  name: string;
  code: string;
  value: string;
}

export interface RouterOsDhcpOptionSet {
  id: string;
  name: string;
  options: string;
}

export interface RouterOsDhcpMatcher {
  id: string;
  name: string;
  server: string;
  code: string;
  value: string;
  matchingType: string;
  optionSet?: string;
}

/**
 * Codifica la URL del ACS como el valor crudo del DHCP Option 43 (vendor-specific)
 * según el mecanismo de auto-configuración DHCP de TR-069 Annex G (Broadband
 * Forum): sub-opción TLV `<code:1 byte><longitud:1 byte><valor ASCII>`, con
 * code=1 para la URL del ACS. No incluye la sub-opción 2 (ProvisioningCode) —
 * opcional y sin uso en este despliegue. Verificado contra un ejemplo real
 * decodificado byte a byte (RouterOS forum): `0x011E<...URL en hex ASCII...>`
 * para una URL de 30 caracteres (0x1E).
 */
export function encodeAcsUrlDhcpOption43(acsUrl: string): string {
  const urlBytes = Buffer.from(acsUrl, 'ascii');
  if (urlBytes.length > 255) {
    throw new Error(
      `La URL del ACS es demasiado larga para DHCP Option 43 (${urlBytes.length} bytes, máximo 255): "${acsUrl}"`,
    );
  }
  const lengthHex = urlBytes.length.toString(16).padStart(2, '0');
  const urlHex = urlBytes.toString('hex');
  return `0x01${lengthHex}${urlHex}`;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Cliente contra la REST API de RouterOS v7+ (`/rest/...`).
 * Soporta gestión completa e idempotente de Perfiles PPP y Secretos PPPoE (Nivel 2).
 */
export class RouterOsClient {
  private static readonly insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

  constructor(
    private readonly config: RouterOsClientConfig,
    private readonly http: Pick<AxiosInstance, 'get' | 'post' | 'put' | 'patch' | 'delete'> = axios,
  ) {}

  async testConnection(): Promise<RouterOsConnectionResult> {
    try {
      await this.http.get(this.buildUrl('system/identity'), this.buildRequestConfig());
      return { ok: true };
    } catch (error) {
      return { ok: false, error: this.describeError(error) };
    }
  }

  /** Devuelve null si el nodo no tiene ningún secreto PPP con ese nombre. */
  async findPppSecretByName(name: string): Promise<RouterOsPppSecret | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ppp/secret'), {
        ...this.buildRequestConfig(),
        params: { name },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.name === name);
    if (!match) {
      return null;
    }

    return {
      id: match['.id'],
      name: match.name,
      disabled: match.disabled === true || match.disabled === 'true',
      profile: match.profile,
      service: match.service,
      remoteAddress: match['remote-address'],
      comment: match.comment,
    };
  }

  /**
   * Crea un nuevo secreto PPPoE en RouterOS usando PUT.
   */
  async createPppSecret(options: CreatePppSecretOptions): Promise<RouterOsPppSecret> {
    const payload: Record<string, string> = {
      name: options.name,
      profile: options.profile,
      service: options.service || 'pppoe',
      disabled: options.disabled ? 'true' : 'false',
    };

    if (options.password) payload.password = options.password;
    if (options.remoteAddress) payload['remote-address'] = options.remoteAddress;
    if (options.localAddress) payload['local-address'] = options.localAddress;
    if (options.comment) payload.comment = options.comment;

    try {
      const response = await this.http.put(this.buildUrl('ppp/secret'), payload, this.buildRequestConfig());
      const data = response.data;
      return {
        id: data?.['.id'] || '',
        name: data?.name || options.name,
        disabled: data?.disabled === true || data?.disabled === 'true',
        profile: data?.profile || options.profile,
        service: data?.service || options.service,
        remoteAddress: data?.['remote-address'],
        comment: data?.comment,
      };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Asegura la existencia y actualización de un secreto PPP de manera idempotente.
   */
  async ensurePppSecret(options: CreatePppSecretOptions): Promise<RouterOsPppSecret> {
    const existing = await this.findPppSecretByName(options.name);
    if (!existing) {
      return await this.createPppSecret(options);
    }

    const updates: Record<string, string> = {};
    if (options.profile && existing.profile !== options.profile) {
      updates.profile = options.profile;
    }
    if (options.password) {
      updates.password = options.password;
    }
    if (options.remoteAddress && existing.remoteAddress !== options.remoteAddress) {
      updates['remote-address'] = options.remoteAddress;
    }
    if (options.comment && existing.comment !== options.comment) {
      updates.comment = options.comment;
    }
    if (options.disabled !== undefined) {
      const disabledBool = options.disabled;
      if (existing.disabled !== disabledBool) {
        updates.disabled = disabledBool ? 'true' : 'false';
      }
    }

    if (Object.keys(updates).length > 0) {
      try {
        await this.http.patch(
          this.buildUrl(`ppp/secret/${encodeURIComponent(existing.id)}`),
          updates,
          this.buildRequestConfig(),
        );
      } catch (error) {
        throw new Error(this.describeError(error));
      }
    }

    return {
      ...existing,
      profile: updates.profile || existing.profile,
      disabled: updates.disabled !== undefined ? updates.disabled === 'true' : existing.disabled,
    };
  }

  /** Habilita/deshabilita un secreto PPP ya existente. */
  async setPppSecretDisabled(secretId: string, disabled: boolean): Promise<void> {
    try {
      await this.http.patch(
        this.buildUrl(`ppp/secret/${encodeURIComponent(secretId)}`),
        { disabled: disabled ? 'true' : 'false' },
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Reasigna el perfil de velocidad de un secreto PPP ya existente. */
  async setPppSecretProfile(secretId: string, profileName: string): Promise<void> {
    try {
      await this.http.patch(
        this.buildUrl(`ppp/secret/${encodeURIComponent(secretId)}`),
        { profile: profileName },
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Devuelve null si el nodo no tiene ningún perfil PPP con ese nombre. */
  async findProfileByName(name: string): Promise<RouterOsPppProfile | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ppp/profile'), {
        ...this.buildRequestConfig(),
        params: { name },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.name === name);
    if (!match) {
      return null;
    }

    return {
      id: match['.id'],
      name: match.name,
      rateLimit: match['rate-limit'],
      parentQueue: match['parent-queue'],
      localAddress: match['local-address'],
      remoteAddress: match['remote-address'],
      onlyOne: match['only-one'] !== undefined ? (match['only-one'] === true || match['only-one'] === 'yes') : undefined,
      dnsServer: match['dns-server'],
    };
  }

  /** Devuelve la lista completa de perfiles PPP configurados en el router (/ppp/profile). */
  async getProfiles(): Promise<RouterOsPppProfile[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ppp/profile'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => ({
      id: entry['.id'],
      name: entry.name,
      rateLimit: entry['rate-limit'],
      parentQueue: entry['parent-queue'],
      localAddress: entry['local-address'],
      remoteAddress: entry['remote-address'],
      onlyOne: entry['only-one'] !== undefined ? (entry['only-one'] === true || entry['only-one'] === 'yes') : undefined,
      dnsServer: entry['dns-server'],
    }));
  }

  /** Elimina un perfil PPP en RouterOS por su .id. */
  async deleteProfile(profileId: string): Promise<void> {
    try {
      await this.http.delete(
        this.buildUrl(`ppp/profile/${encodeURIComponent(profileId)}`),
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Obtiene la lista de pools de IP configurados en RouterOS (/ip/pool). */
  async getIpPools(): Promise<RouterOsIpPool[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/pool'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => ({
      id: entry['.id'],
      name: entry.name,
      ranges: entry.ranges,
      nextPool: entry['next-pool'],
    }));
  }

  /**
   * Direcciones de un pool que el router ya tiene entregadas en este momento
   * (/ip/pool/used) — cubre tanto los secrets PPP con remote-address estático
   * como cualquier lease dinámica activa tomada del pool. Sin esto, "IPs
   * disponibles" solo contaría lo que SUMTECH sabe que asignó, no lo que el
   * router realmente tiene ocupado (ej. un secret creado a mano fuera de la app).
   */
  async getUsedPoolAddresses(poolName: string): Promise<string[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/pool/used'), {
        ...this.buildRequestConfig(),
        params: { pool: poolName },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    return results
      .map((entry: any) => (typeof entry.address === 'string' ? entry.address.split('/')[0] : undefined))
      .filter((ip: string | undefined): ip is string => Boolean(ip));
  }

  /** Obtiene la lista completa de secretos PPP configurados en RouterOS (/ppp/secret). */
  async getPppSecrets(): Promise<RouterOsPppSecret[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ppp/secret'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((match: any) => ({
      id: match['.id'],
      name: match.name,
      disabled: match.disabled === true || match.disabled === 'true',
      profile: match.profile,
      service: match.service,
      remoteAddress: match['remote-address'],
      comment: match.comment,
    }));
  }

  /**
   * Crea un perfil PPP nuevo con rate-limit, cola padre y pools opcionales.
   */
  async createProfile(
    name: string,
    rateLimit: string,
    options?: EnsureProfileOptions,
  ): Promise<RouterOsPppProfile> {
    const payload: Record<string, string> = {
      name,
      'rate-limit': rateLimit,
    };

    if (options?.parentQueue) payload['parent-queue'] = options.parentQueue;
    if (options?.localAddress) payload['local-address'] = options.localAddress;
    if (options?.remoteAddress) payload['remote-address'] = options.remoteAddress;
    if (options?.onlyOne !== undefined) payload['only-one'] = options.onlyOne ? 'yes' : 'no';
    if (options?.dnsServer) payload['dns-server'] = options.dnsServer;

    try {
      const response = await this.http.put(this.buildUrl('ppp/profile'), payload, this.buildRequestConfig());
      const created = response.data;
      return {
        id: created?.['.id'],
        name: created?.name ?? name,
        rateLimit: created?.['rate-limit'] ?? rateLimit,
        parentQueue: created?.['parent-queue'] ?? options?.parentQueue,
        localAddress: created?.['local-address'] ?? options?.localAddress,
        remoteAddress: created?.['remote-address'] ?? options?.remoteAddress,
        onlyOne: options?.onlyOne,
        dnsServer: created?.['dns-server'] ?? options?.dnsServer,
      };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Actualiza los atributos de un perfil PPP existente. */
  async updateProfile(
    profileId: string,
    rateLimit?: string,
    options?: EnsureProfileOptions,
  ): Promise<void> {
    const payload: Record<string, string> = {};
    if (rateLimit) payload['rate-limit'] = rateLimit;
    if (options?.parentQueue !== undefined) payload['parent-queue'] = options.parentQueue;
    if (options?.localAddress !== undefined) payload['local-address'] = options.localAddress;
    if (options?.remoteAddress !== undefined) payload['remote-address'] = options.remoteAddress;
    if (options?.onlyOne !== undefined) payload['only-one'] = options.onlyOne ? 'yes' : 'no';
    if (options?.dnsServer !== undefined) payload['dns-server'] = options.dnsServer;

    try {
      await this.http.patch(
        this.buildUrl(`ppp/profile/${encodeURIComponent(profileId)}`),
        payload,
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Garantiza que exista el perfil de velocidad con sus colas y pools correspondientes.
   */
  async ensureProfile(
    name: string,
    rateLimit: string,
    options?: EnsureProfileOptions,
  ): Promise<RouterOsPppProfile> {
    const existing = await this.findProfileByName(name);
    if (!existing) {
      return this.createProfile(name, rateLimit, options);
    }

    const needsUpdate =
      existing.rateLimit !== rateLimit ||
      (options?.parentQueue && existing.parentQueue !== options.parentQueue) ||
      (options?.localAddress && existing.localAddress !== options.localAddress) ||
      (options?.remoteAddress && existing.remoteAddress !== options.remoteAddress) ||
      (options?.dnsServer !== undefined && existing.dnsServer !== options.dnsServer);

    if (needsUpdate) {
      await this.updateProfile(existing.id, rateLimit, options);
    }

    return {
      ...existing,
      rateLimit,
      parentQueue: options?.parentQueue ?? existing.parentQueue,
      localAddress: options?.localAddress ?? existing.localAddress,
      remoteAddress: options?.remoteAddress ?? existing.remoteAddress,
      dnsServer: options?.dnsServer ?? existing.dnsServer,
    };
  }

  /**
   * Garantiza la existencia del perfil de corte/suspensión (ej. Sumtech-Corte).
   */
  async ensureSuspensionProfile(
    profileName = 'Sumtech-Corte',
    rateLimit = '256k/256k',
  ): Promise<RouterOsPppProfile> {
    return await this.ensureProfile(profileName, rateLimit, { onlyOne: true });
  }

  /**
   * Consulta si existe una sesión activa para el usuario en `/ppp/active`.
   */
  async findActiveSessionByName(username: string): Promise<RouterOsActivePppSession | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ppp/active'), {
        ...this.buildRequestConfig(),
        params: { name: username },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((s: any) => s?.name === username);
    if (!match) return null;

    return {
      id: match['.id'],
      name: match.name,
      service: match.service,
      callerId: match['caller-id'],
      address: match.address,
      uptime: match.uptime,
      encoding: match.encoding,
      sessionId: match['session-id'],
    };
  }

  /**
   * Obtiene todas las sesiones activas en el nodo.
   */
  async getActiveSessions(): Promise<RouterOsActivePppSession[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ppp/active'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((s: any) => ({
      id: s['.id'],
      name: s.name,
      service: s.service,
      callerId: s['caller-id'],
      address: s.address,
      uptime: s.uptime,
      encoding: s.encoding,
      sessionId: s['session-id'],
    }));
  }

  /**
   * Expulsa la sesión activa de un abonado para aplicar corte, cambio de plan o refresco en caliente.
   */
  async killActiveSession(username: string): Promise<boolean> {
    const session = await this.findActiveSessionByName(username);
    if (!session || !session.id) {
      return false;
    }

    try {
      await this.http.delete(
        this.buildUrl(`ppp/active/${encodeURIComponent(session.id)}`),
        this.buildRequestConfig(),
      );
      return true;
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Busca una sub-interfaz VLAN existente por su VLAN ID (/interface/vlan).
   * Devuelve null si no existe todavía en este router.
   */
  async findVlanInterfaceByVlanId(vlanId: number): Promise<RouterOsVlanInterface | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('interface/vlan'), {
        ...this.buildRequestConfig(),
        params: { 'vlan-id': String(vlanId) },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => Number(entry?.['vlan-id']) === vlanId);
    if (!match) {
      return null;
    }

    return {
      id: match['.id'],
      name: match.name,
      vlanId: Number(match['vlan-id']),
      interface: match.interface,
    };
  }

  /**
   * Lista TODAS las sub-interfaces VLAN reales configuradas en el router
   * (/interface/vlan), sin filtrar por ninguna ya conocida por Sumtech --
   * usada para el descubrimiento de configuración brownfield (ver
   * Plan_Implementacion_Descubrimiento_RouterOS_Brownfield.md Fase 0/1).
   * Solo lectura, sin side-effects.
   */
  async listVlanInterfaces(): Promise<RouterOsVlanInterface[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('interface/vlan'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => ({
      id: entry['.id'],
      name: entry.name,
      vlanId: Number(entry['vlan-id']),
      interface: entry.interface,
    }));
  }

  /**
   * Asegura que exista la sub-interfaz VLAN (idempotente: crea si falta,
   * no hace nada si ya existe con la misma interfaz padre — en RouterOS no
   * hay "modo trunk" aparte: un puerto con varias VLAN encima YA ES trunk).
   */
  async ensureVlanInterface(options: EnsureVlanInterfaceOptions): Promise<RouterOsVlanInterface> {
    const existing = await this.findVlanInterfaceByVlanId(options.vlanId);
    if (existing) {
      return existing;
    }

    const payload: Record<string, string> = {
      name: options.name,
      'vlan-id': String(options.vlanId),
      interface: options.parentInterface,
    };
    if (options.comment) payload.comment = options.comment;

    try {
      const response = await this.http.put(this.buildUrl('interface/vlan'), payload, this.buildRequestConfig());
      const data = response.data;
      return {
        id: data?.['.id'] || '',
        name: data?.name || options.name,
        vlanId: options.vlanId,
        interface: data?.interface || options.parentInterface,
      };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca una IP ya asignada a una interfaz (/ip/address). Null si no existe. */
  /** Devuelve TODAS las IPs configuradas en el router (/ip/address) — diagnóstico de topología real. */
  async getIpAddresses(): Promise<RouterOsIpAddress[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/address'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => ({
      id: entry['.id'],
      address: entry.address,
      interface: entry.interface,
      comment: entry.comment,
    }));
  }

  async findIpAddressByInterface(interfaceName: string): Promise<RouterOsIpAddress | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/address'), {
        ...this.buildRequestConfig(),
        params: { interface: interfaceName },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.interface === interfaceName);
    if (!match) {
      return null;
    }

    return { id: match['.id'], address: match.address, interface: match.interface, comment: match.comment };
  }

  /**
   * Asegura que una interfaz tenga la IP indicada asignada (idempotente por
   * interfaz — no permite dos IPs distintas en la misma interfaz vía este
   * método, asume una IP de gateway por VLAN). Si `allowReplace` es true y ya
   * había otra IP asignada, la reemplaza (DELETE + PUT) en vez de lanzar —
   * uso explícito: una resincronización donde el usuario corrige a propósito
   * un gateway mal tipeado, no una colisión accidental.
   */
  async ensureIpAddress(interfaceName: string, address: string, comment?: string, allowReplace = false): Promise<RouterOsIpAddress> {
    const existing = await this.findIpAddressByInterface(interfaceName);
    if (existing) {
      if (existing.address !== address) {
        if (!allowReplace) {
          throw new Error(
            `La interfaz "${interfaceName}" ya tiene la IP "${existing.address}" asignada (se esperaba "${address}") — no se sobreescribe automáticamente.`,
          );
        }
        await this.removeIpAddress(existing.id);
      } else {
        return existing;
      }
    }

    const payload: Record<string, string> = { address, interface: interfaceName };
    if (comment) payload.comment = comment;

    try {
      const response = await this.http.put(this.buildUrl('ip/address'), payload, this.buildRequestConfig());
      const data = response.data;
      return {
        id: data?.['.id'] || '',
        address: data?.address || address,
        interface: data?.interface || interfaceName,
        comment: data?.comment,
      };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Elimina una IP asignada en RouterOS por su .id (/ip/address). */
  async removeIpAddress(addressId: string): Promise<void> {
    try {
      await this.http.delete(
        this.buildUrl(`ip/address/${encodeURIComponent(addressId)}`),
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Elimina una sub-interfaz VLAN en RouterOS por su .id (/interface/vlan). */
  async removeVlanInterface(vlanInterfaceId: string): Promise<void> {
    try {
      await this.http.delete(
        this.buildUrl(`interface/vlan/${encodeURIComponent(vlanInterfaceId)}`),
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca un cliente DHCP ya configurado sobre una interfaz (/ip/dhcp-client). */
  async findDhcpClientByInterface(interfaceName: string): Promise<RouterOsDhcpClient | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/dhcp-client'), {
        ...this.buildRequestConfig(),
        params: { interface: interfaceName },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.interface === interfaceName);
    if (!match) {
      return null;
    }
    return { id: match['.id'], interface: match.interface, disabled: match.disabled === true || match.disabled === 'true' };
  }

  /** Asegura que la interfaz tenga un cliente DHCP activo (idempotente). */
  async ensureDhcpClient(interfaceName: string, addDefaultRoute = true): Promise<RouterOsDhcpClient> {
    const existing = await this.findDhcpClientByInterface(interfaceName);
    if (existing) {
      return existing;
    }

    const payload: Record<string, string> = {
      interface: interfaceName,
      'add-default-route': addDefaultRoute ? 'yes' : 'no',
      'use-peer-dns': 'yes',
    };

    try {
      const response = await this.http.put(this.buildUrl('ip/dhcp-client'), payload, this.buildRequestConfig());
      const data = response.data;
      return { id: data?.['.id'] || '', interface: data?.interface || interfaceName, disabled: false };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca una interfaz PPPoE-client ya configurada por nombre (/interface/pppoe-client). */
  async findPppoeClientByName(name: string): Promise<RouterOsPppoeClient | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('interface/pppoe-client'), {
        ...this.buildRequestConfig(),
        params: { name },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.name === name);
    if (!match) {
      return null;
    }
    return {
      id: match['.id'],
      name: match.name,
      interface: match.interface,
      user: match.user,
      disabled: match.disabled === true || match.disabled === 'true',
    };
  }

  /**
   * Asegura la interfaz PPPoE-client hacia el proveedor de tránsito
   * (idempotente: crea si falta, actualiza usuario/contraseña si cambiaron).
   */
  async ensurePppoeClient(options: EnsurePppoeClientOptions): Promise<RouterOsPppoeClient> {
    const existing = await this.findPppoeClientByName(options.name);
    if (!existing) {
      const payload: Record<string, string> = {
        name: options.name,
        interface: options.parentInterface,
        user: options.user,
        password: options.password,
        'add-default-route': options.addDefaultRoute === false ? 'no' : 'yes',
        disabled: 'no',
      };
      try {
        const response = await this.http.put(this.buildUrl('interface/pppoe-client'), payload, this.buildRequestConfig());
        const data = response.data;
        return {
          id: data?.['.id'] || '',
          name: data?.name || options.name,
          interface: data?.interface || options.parentInterface,
          user: data?.user || options.user,
          disabled: false,
        };
      } catch (error) {
        throw new Error(this.describeError(error));
      }
    }

    const updates: Record<string, string> = {};
    if (existing.user !== options.user) updates.user = options.user;
    updates.password = options.password;

    try {
      await this.http.patch(
        this.buildUrl(`interface/pppoe-client/${encodeURIComponent(existing.id)}`),
        updates,
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    return { ...existing, user: options.user };
  }

  /** Busca una ruta ya existente hacia un destino dado (ej. "0.0.0.0/0"). */
  async findRouteByDestination(dstAddress: string): Promise<RouterOsRoute | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/route'), {
        ...this.buildRequestConfig(),
        params: { 'dst-address': dstAddress },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.['dst-address'] === dstAddress);
    if (!match) {
      return null;
    }
    return { id: match['.id'], dstAddress: match['dst-address'], gateway: match.gateway, comment: match.comment };
  }

  /**
   * Asegura la ruta por defecto hacia un gateway dado (solo aplica a WAN
   * en modo STATIC — DHCP_CLIENT/PPPOE_CLIENT ya agregan su propia ruta por
   * defecto vía add-default-route=yes).
   */
  async ensureDefaultRoute(gateway: string, comment?: string): Promise<RouterOsRoute> {
    const existing = await this.findRouteByDestination('0.0.0.0/0');
    if (existing) {
      if (existing.gateway !== gateway) {
        throw new Error(
          `Ya existe una ruta por defecto hacia "${existing.gateway}" (se esperaba "${gateway}") — no se sobreescribe automáticamente.`,
        );
      }
      return existing;
    }

    const payload: Record<string, string> = { 'dst-address': '0.0.0.0/0', gateway };
    if (comment) payload.comment = comment;

    try {
      const response = await this.http.put(this.buildUrl('ip/route'), payload, this.buildRequestConfig());
      const data = response.data;
      return { id: data?.['.id'] || '', dstAddress: '0.0.0.0/0', gateway: data?.gateway || gateway, comment: data?.comment };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca un pool de IPs existente por nombre (/ip/pool). */
  async findIpPoolByName(name: string): Promise<{ id: string; name: string; ranges: string } | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/pool'), { ...this.buildRequestConfig(), params: { name } });
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.name === name);
    return match ? { id: match['.id'], name: match.name, ranges: match.ranges } : null;
  }

  /** Asegura un pool de IPs (idempotente por nombre; para el pool DHCP de una VLAN). */
  async ensureIpPool(name: string, ranges: string): Promise<{ id: string; name: string; ranges: string }> {
    const existing = await this.findIpPoolByName(name);
    if (existing) {
      return existing;
    }
    try {
      const response = await this.http.put(this.buildUrl('ip/pool'), { name, ranges }, this.buildRequestConfig());
      const data = response.data;
      return { id: data?.['.id'] || '', name: data?.name || name, ranges: data?.ranges || ranges };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca una red DHCP ya configurada por su dirección (/ip/dhcp-server/network). */
  async findDhcpServerNetworkByAddress(addressCidr: string): Promise<{ id: string } | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/dhcp-server/network'), {
        ...this.buildRequestConfig(),
        params: { address: addressCidr },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.address === addressCidr);
    return match ? { id: match['.id'] } : null;
  }

  /** Asegura la red DHCP (gateway + DNS) para un rango dado (idempotente por dirección). */
  async ensureDhcpServerNetwork(addressCidr: string, gateway: string, dnsServers?: string): Promise<void> {
    const existing = await this.findDhcpServerNetworkByAddress(addressCidr);
    if (existing) {
      return;
    }
    const payload: Record<string, string> = { address: addressCidr, gateway };
    if (dnsServers) payload['dns-server'] = dnsServers;
    try {
      await this.http.put(this.buildUrl('ip/dhcp-server/network'), payload, this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca un servidor DHCP ya configurado sobre una interfaz (/ip/dhcp-server). */
  async findDhcpServerByInterface(interfaceName: string): Promise<{ id: string; name: string; addressPool?: string } | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/dhcp-server'), {
        ...this.buildRequestConfig(),
        params: { interface: interfaceName },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.interface === interfaceName);
    return match ? { id: match['.id'], name: match.name, addressPool: match['address-pool'] } : null;
  }

  /**
   * Lista TODOS los servidores DHCP reales configurados en el router
   * (/ip/dhcp-server), sin filtrar por interfaz -- descubrimiento brownfield
   * (ver Plan_Implementacion_Descubrimiento_RouterOS_Brownfield.md Fase 2).
   * Solo lectura.
   */
  async listDhcpServers(): Promise<RouterOsDhcpServer[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/dhcp-server'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => ({
      id: entry['.id'],
      name: entry.name,
      interface: entry.interface,
      addressPool: entry['address-pool'],
      disabled: entry.disabled === true || entry.disabled === 'true',
    }));
  }

  /** Asegura el servidor DHCP sobre una interfaz, usando un pool ya asegurado (idempotente). */
  async ensureDhcpServer(name: string, interfaceName: string, addressPool: string, leaseTimeSec = 86400): Promise<{ id: string; name: string }> {
    const existing = await this.findDhcpServerByInterface(interfaceName);
    if (existing) {
      return existing;
    }
    try {
      const response = await this.http.put(
        this.buildUrl('ip/dhcp-server'),
        { name, interface: interfaceName, 'address-pool': addressPool, 'lease-time': `${leaseTimeSec}s`, disabled: 'no' },
        this.buildRequestConfig(),
      );
      const data = response.data;
      return { id: data?.['.id'] || '', name: data?.name || name };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca un servidor PPPoE ya configurado sobre una interfaz (/interface/pppoe-server/server). */
  async findPppoeServerByInterface(interfaceName: string): Promise<RouterOsPppoeServer | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('interface/pppoe-server/server'), {
        ...this.buildRequestConfig(),
        params: { interface: interfaceName },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.interface === interfaceName);
    return match ? this.mapPppoeServerEntry(match) : null;
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

  /**
   * Lista TODOS los servidores PPPoE reales configurados en el router
   * (/interface/pppoe-server/server), sin filtrar por interfaz --
   * descubrimiento brownfield (ver
   * Plan_Implementacion_Descubrimiento_RouterOS_Brownfield.md Fase 2).
   * Solo lectura.
   */
  async listPppoeServers(): Promise<RouterOsPppoeServer[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('interface/pppoe-server/server'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => this.mapPppoeServerEntry(entry));
  }

  /** Asegura un servidor PPPoE sobre una interfaz (idempotente: no duplica si ya existe). */
  async ensurePppoeServer(options: EnsurePppoeServerOptions): Promise<RouterOsPppoeServer> {
    const existing = await this.findPppoeServerByInterface(options.interfaceName);
    if (existing) {
      return existing;
    }
    const serviceName = options.serviceName || `pppoe-${options.interfaceName}`;
    const defaultProfile = options.defaultProfile || 'default';
    const oneSessionPerHost = options.oneSessionPerHost !== false ? 'yes' : 'no';

    const payload: Record<string, string> = {
      'service-name': serviceName,
      interface: options.interfaceName,
      'default-profile': defaultProfile,
      'one-session-per-host': oneSessionPerHost,
      disabled: 'no',
    };
    if (options.authentication) {
      payload.authentication = options.authentication;
    }

    try {
      const response = await this.http.put(
        this.buildUrl('interface/pppoe-server/server'),
        payload,
        this.buildRequestConfig(),
      );
      const data = response.data;
      return {
        id: data?.['.id'] || '',
        serviceName: data?.['service-name'] || serviceName,
        interface: options.interfaceName,
        defaultProfile,
        disabled: false,
        oneSessionPerHost: options.oneSessionPerHost !== false,
      };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca una lease estática existente por MAC (/ip/dhcp-server/lease). */
  async findStaticLeaseByMac(macAddress: string): Promise<RouterOsDhcpLease | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/dhcp-server/lease'), {
        ...this.buildRequestConfig(),
        params: { 'mac-address': macAddress },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.['mac-address']?.toUpperCase() === macAddress.toUpperCase());
    if (!match) {
      return null;
    }
    return {
      id: match['.id'],
      address: match.address,
      macAddress: match['mac-address'],
      server: match.server,
      disabled: match.disabled === true || match.disabled === 'true',
      comment: match.comment,
    };
  }

  /**
   * Asegura la lease estática MAC→IP (identidad del cliente en el medio
   * DHCP, equivalente al secret PPPoE). Idempotente: actualiza la IP/server
   * si cambiaron, no duplica.
   */
  async ensureStaticLease(macAddress: string, address: string, server: string, comment?: string): Promise<RouterOsDhcpLease> {
    const existing = await this.findStaticLeaseByMac(macAddress);
    if (!existing) {
      const payload: Record<string, string> = { 'mac-address': macAddress, address, server, disabled: 'no' };
      if (comment) payload.comment = comment;
      try {
        const response = await this.http.put(this.buildUrl('ip/dhcp-server/lease'), payload, this.buildRequestConfig());
        const data = response.data;
        return {
          id: data?.['.id'] || '',
          address: data?.address || address,
          macAddress: data?.['mac-address'] || macAddress,
          server: data?.server || server,
          disabled: false,
        };
      } catch (error) {
        throw new Error(this.describeError(error));
      }
    }

    const updates: Record<string, string> = {};
    if (existing.address !== address) updates.address = address;
    if (existing.server !== server) updates.server = server;

    if (Object.keys(updates).length > 0) {
      try {
        await this.http.patch(
          this.buildUrl(`ip/dhcp-server/lease/${encodeURIComponent(existing.id)}`),
          updates,
          this.buildRequestConfig(),
        );
      } catch (error) {
        throw new Error(this.describeError(error));
      }
    }

    return { ...existing, address, server };
  }

  /** Habilita/deshabilita una lease estática ya existente (suspensión/reactivación DHCP). */
  async setLeaseDisabled(leaseId: string, disabled: boolean): Promise<void> {
    try {
      await this.http.patch(
        this.buildUrl(`ip/dhcp-server/lease/${encodeURIComponent(leaseId)}`),
        { disabled: disabled ? 'true' : 'false' },
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca una simple-queue existente por nombre (/queue/simple). */
  async findSimpleQueueByName(name: string): Promise<RouterOsSimpleQueue | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('queue/simple'), { ...this.buildRequestConfig(), params: { name } });
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.name === name);
    if (!match) {
      return null;
    }
    return {
      id: match['.id'],
      name: match.name,
      target: match.target,
      maxLimit: match['max-limit'],
      disabled: match.disabled === true || match.disabled === 'true',
    };
  }

  /**
   * Asegura la simple-queue de rate-limit para un target (IP del cliente)
   * — equivalente DHCP del perfil PPP con rate-limit. Idempotente: actualiza
   * el límite si cambió.
   */
  async ensureSimpleQueue(name: string, target: string, maxLimit: string): Promise<RouterOsSimpleQueue> {
    const existing = await this.findSimpleQueueByName(name);
    if (!existing) {
      try {
        const response = await this.http.put(
          this.buildUrl('queue/simple'),
          { name, target, 'max-limit': maxLimit, disabled: 'no' },
          this.buildRequestConfig(),
        );
        const data = response.data;
        return { id: data?.['.id'] || '', name: data?.name || name, target: data?.target || target, maxLimit: data?.['max-limit'] || maxLimit, disabled: false };
      } catch (error) {
        throw new Error(this.describeError(error));
      }
    }

    const updates: Record<string, string> = {};
    if (existing.target !== target) updates.target = target;
    if (existing.maxLimit !== maxLimit) updates['max-limit'] = maxLimit;

    if (Object.keys(updates).length > 0) {
      try {
        await this.http.patch(this.buildUrl(`queue/simple/${encodeURIComponent(existing.id)}`), updates, this.buildRequestConfig());
      } catch (error) {
        throw new Error(this.describeError(error));
      }
    }

    return { ...existing, target, maxLimit };
  }

  /** Habilita/deshabilita una simple-queue ya existente. */
  async setSimpleQueueDisabled(queueId: string, disabled: boolean): Promise<void> {
    try {
      await this.http.patch(
        this.buildUrl(`queue/simple/${encodeURIComponent(queueId)}`),
        { disabled: disabled ? 'true' : 'false' },
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Agrega una IP a una address-list en /ip/firewall/address-list (RF-PORTAL-001).
   */
  async addAddressListEntry(list: string, address: string, comment?: string): Promise<void> {
    try {
      await this.http.put(
        this.buildUrl('ip/firewall/address-list'),
        {
          list,
          address,
          ...(comment ? { comment } : {}),
        },
        this.buildRequestConfig(),
      );
    } catch (error: any) {
      const msg = this.describeError(error);
      if (!msg.includes('already exists')) {
        // En RouterOS a veces devuelve error si ya está registrada
      }
    }
  }

  /**
   * Remueve una IP de una address-list en /ip/firewall/address-list (RF-PORTAL-001).
   */
  async removeAddressListEntry(list: string, address: string): Promise<void> {
    try {
      const response = await this.http.get(this.buildUrl('ip/firewall/address-list'), {
        ...this.buildRequestConfig(),
        params: { list, address },
      });
      const entries = Array.isArray(response.data) ? response.data : [];
      for (const entry of entries) {
        if (entry['.id']) {
          await this.http.delete(
            this.buildUrl(`ip/firewall/address-list/${encodeURIComponent(entry['.id'])}`),
            this.buildRequestConfig(),
          );
        }
      }
    } catch {
      // Ignorar si no existe
    }
  }

  /**
   * Agrega una regla NAT en /ip/firewall/nat (RF-PORTAL-001).
   */
  async addFirewallNatRule(rule: Record<string, string>): Promise<void> {
    try {
      await this.http.put(this.buildUrl('ip/firewall/nat'), rule, this.buildRequestConfig());
    } catch {
      // Ignorar si ya existe
    }
  }

  /** Actualiza una regla NAT existente por su .id (ej. refrescar el destino de un DST-NAT ya creado). */
  async updateFirewallNatRule(ruleId: string, rule: Record<string, string>): Promise<void> {
    try {
      await this.http.patch(
        this.buildUrl(`ip/firewall/nat/${encodeURIComponent(ruleId)}`),
        rule,
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Agrega una regla filter en /ip/firewall/filter (RF-PORTAL-001).
   */
  async addFirewallFilterRule(rule: Record<string, string>): Promise<void> {
    try {
      await this.http.put(this.buildUrl('ip/firewall/filter'), rule, this.buildRequestConfig());
    } catch {
      // Ignorar si ya existe
    }
  }

  /** Busca una regla NAT existente por su comentario (idempotencia real, a diferencia de addFirewallNatRule). Pública: también la usa la reconciliación de solo lectura. */
  async findNatRuleByComment(comment: string): Promise<{ id: string } | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/firewall/nat'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.comment === comment);
    return match ? { id: match['.id'] } : null;
  }

  /**
   * Lista TODAS las reglas NAT reales configuradas en el router
   * (/ip/firewall/nat), sin filtrar por comentario -- descubrimiento
   * brownfield, puramente informativo (ver
   * Plan_Implementacion_Descubrimiento_RouterOS_Brownfield.md Fase 3). A
   * propósito NO se ofrece "importar" estas reglas: una regla preexistente
   * puede tener condiciones que ensureNatMasquerade() no replica.
   */
  async listNatRules(): Promise<RouterOsNatRule[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/firewall/nat'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => ({
      id: entry['.id'],
      chain: entry.chain,
      action: entry.action,
      outInterface: entry['out-interface'],
      comment: entry.comment,
      disabled: entry.disabled === true || entry.disabled === 'true',
    }));
  }

  /**
   * Asegura la regla de NAT masquerade de salida hacia Internet (idempotente
   * por `comment` — a diferencia de `addFirewallNatRule`, que no verifica
   * nada antes de insertar). Sin esto, ningún cliente detrás del router
   * puede salir a Internet aunque el WAN ya tenga IP real.
   */
  async ensureNatMasquerade(outInterface: string, comment = 'sumtech-nat-masquerade'): Promise<void> {
    const existing = await this.findNatRuleByComment(comment);
    if (existing) {
      return;
    }
    try {
      await this.http.put(
        this.buildUrl('ip/firewall/nat'),
        { chain: 'srcnat', action: 'masquerade', 'out-interface': outInterface, comment },
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca una regla filter existente por su comentario. Pública: también la usa la reconciliación de solo lectura. */
  async findFilterRuleByComment(comment: string): Promise<{ id: string } | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/firewall/filter'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.comment === comment);
    return match ? { id: match['.id'] } : null;
  }

  /**
   * Lista TODAS las reglas de filter reales configuradas en el router
   * (/ip/firewall/filter), sin filtrar por comentario -- descubrimiento
   * brownfield, puramente informativo (ver
   * Plan_Implementacion_Descubrimiento_RouterOS_Brownfield.md Fase 3). A
   * propósito NO se ofrece "importar" estas reglas: el orden y las
   * condiciones de una regla de firewall preexistente pueden tener
   * implicaciones de seguridad que Sumtech no puede inferir con seguridad.
   */
  async listFilterRules(): Promise<RouterOsFilterRule[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/firewall/filter'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => ({
      id: entry['.id'],
      chain: entry.chain,
      action: entry.action,
      connectionState: entry['connection-state'],
      comment: entry.comment,
      disabled: entry.disabled === true || entry.disabled === 'true',
    }));
  }

  /**
   * Asegura un set FIJO y deliberadamente mínimo de reglas de firewall en el
   * chain input, cada una idempotente por `comment` (a diferencia de
   * `addFirewallFilterRule`, que no verifica nada antes de insertar):
   *   1. aceptar established/related (tráfico de respuesta normal)
   *   2. descartar conexiones "invalid" (higiene estándar anti-spoofing)
   *
   * Deliberadamente NO incluye una regla que restrinja el acceso de gestión
   * (API/Winbox) a una IP específica — eso requeriría saber de antemano cuál
   * es la IP/subred de gestión legítima (ej. el rango WireGuard), y una
   * regla mal armada ahí podría dejar al administrador fuera del router de
   * forma remota e irreversible sin acceso físico. Queda fuera a propósito,
   * no es un olvido.
   */
  async ensureFirewallBaseline(): Promise<void> {
    const rules: Array<{ comment: string; rule: Record<string, string> }> = [
      {
        comment: 'sumtech-baseline-established',
        rule: { chain: 'input', 'connection-state': 'established,related', action: 'accept', comment: 'sumtech-baseline-established' },
      },
      {
        comment: 'sumtech-baseline-drop-invalid',
        rule: { chain: 'input', 'connection-state': 'invalid', action: 'drop', comment: 'sumtech-baseline-drop-invalid' },
      },
    ];

    for (const { comment, rule } of rules) {
      const existing = await this.findFilterRuleByComment(comment);
      if (existing) {
        continue;
      }
      try {
        await this.http.put(this.buildUrl('ip/firewall/filter'), rule, this.buildRequestConfig());
      } catch (error) {
        throw new Error(this.describeError(error));
      }
    }
  }

  /** Busca una opción DHCP cruda ya definida por nombre (/ip/dhcp-server/option). */
  private async findDhcpOptionByName(name: string): Promise<RouterOsDhcpOption | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/dhcp-server/option'), {
        ...this.buildRequestConfig(),
        params: { name },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.name === name);
    if (!match) return null;
    return { id: match['.id'], name: match.name, code: match.code, value: match.value };
  }

  /** Asegura una opción DHCP cruda (ej. vendor-specific/option 43), idempotente por nombre. */
  private async ensureDhcpOption(name: string, code: string, value: string): Promise<RouterOsDhcpOption> {
    const existing = await this.findDhcpOptionByName(name);
    if (existing) {
      if (existing.value !== value) {
        try {
          await this.http.patch(
            this.buildUrl(`ip/dhcp-server/option/${encodeURIComponent(existing.id)}`),
            { value },
            this.buildRequestConfig(),
          );
        } catch (error) {
          throw new Error(this.describeError(error));
        }
        return { ...existing, value };
      }
      return existing;
    }
    try {
      const response = await this.http.put(
        this.buildUrl('ip/dhcp-server/option'),
        { name, code, value },
        this.buildRequestConfig(),
      );
      const data = response.data;
      return { id: data?.['.id'] || '', name: data?.name || name, code: data?.code || code, value: data?.value || value };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca un conjunto de opciones DHCP ya definido por nombre (/ip/dhcp-server/option/sets). */
  private async findDhcpOptionSetByName(name: string): Promise<RouterOsDhcpOptionSet | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/dhcp-server/option/sets'), {
        ...this.buildRequestConfig(),
        params: { name },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.name === name);
    if (!match) return null;
    return { id: match['.id'], name: match.name, options: match.options };
  }

  /** Asegura un conjunto de opciones DHCP, idempotente por nombre. */
  private async ensureDhcpOptionSet(name: string, optionNames: string[]): Promise<RouterOsDhcpOptionSet> {
    const optionsValue = optionNames.join(',');
    const existing = await this.findDhcpOptionSetByName(name);
    if (existing) {
      if (existing.options !== optionsValue) {
        try {
          await this.http.patch(
            this.buildUrl(`ip/dhcp-server/option/sets/${encodeURIComponent(existing.id)}`),
            { options: optionsValue },
            this.buildRequestConfig(),
          );
        } catch (error) {
          throw new Error(this.describeError(error));
        }
        return { ...existing, options: optionsValue };
      }
      return existing;
    }
    try {
      const response = await this.http.put(
        this.buildUrl('ip/dhcp-server/option/sets'),
        { name, options: optionsValue },
        this.buildRequestConfig(),
      );
      const data = response.data;
      return { id: data?.['.id'] || '', name: data?.name || name, options: data?.options || optionsValue };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Busca un matcher DHCP ya definido por nombre (/ip/dhcp-server/matcher). */
  private async findDhcpMatcherByName(name: string): Promise<RouterOsDhcpMatcher | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/dhcp-server/matcher'), {
        ...this.buildRequestConfig(),
        params: { name },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const match = results.find((entry: any) => entry?.name === name);
    if (!match) return null;
    return {
      id: match['.id'],
      name: match.name,
      server: match.server,
      code: match.code,
      value: match.value,
      matchingType: match['matching-type'],
      optionSet: match['option-set'],
    };
  }

  /**
   * Asegura, de forma idempotente, la auto-configuración TR-069 vía DHCP
   * Option 43 (Broadband Forum TR-069 Annex G): crea/actualiza la opción
   * cruda con la URL del ACS codificada, su option-set, y el matcher que la
   * aplica a cualquier cliente DHCP cuyo Option 60 (vendor-class-id)
   * contenga "dslforum.org" — el identificador estándar con el que un CPE
   * anuncia soporte de auto-configuración TR-069 vía DHCP. El radio de
   * impacto es intencionalmente acotado por el propio matcher: nunca afecta
   * a un cliente DHCP que no declare explícitamente ese soporte.
   */
  async ensureAcsAutoProvisioning(
    acsUrl: string,
    namePrefix = 'sumtech-tr069',
    server: 'all' | string = 'all',
  ): Promise<RouterOsDhcpMatcher> {
    const optionName = `${namePrefix}-acs-url`;
    const optionSetName = `${namePrefix}-autoconf`;
    const matcherName = `${namePrefix}-dslforum`;

    const encodedValue = encodeAcsUrlDhcpOption43(acsUrl);
    await this.ensureDhcpOption(optionName, 'vendor-specific', encodedValue);
    await this.ensureDhcpOptionSet(optionSetName, [optionName]);

    const existingMatcher = await this.findDhcpMatcherByName(matcherName);
    if (existingMatcher) {
      if (existingMatcher.optionSet !== optionSetName || existingMatcher.server !== server) {
        try {
          await this.http.patch(
            this.buildUrl(`ip/dhcp-server/matcher/${encodeURIComponent(existingMatcher.id)}`),
            { server, 'option-set': optionSetName },
            this.buildRequestConfig(),
          );
        } catch (error) {
          throw new Error(this.describeError(error));
        }
        return { ...existingMatcher, server, optionSet: optionSetName };
      }
      return existingMatcher;
    }

    try {
      const response = await this.http.put(
        this.buildUrl('ip/dhcp-server/matcher'),
        {
          name: matcherName,
          server,
          code: '60',
          value: 'dslforum.org',
          'matching-type': 'substring',
          'option-set': optionSetName,
        },
        this.buildRequestConfig(),
      );
      const data = response.data;
      return {
        id: data?.['.id'] || '',
        name: data?.name || matcherName,
        server: data?.server || server,
        code: data?.code || '60',
        value: data?.value || 'dslforum.org',
        matchingType: data?.['matching-type'] || 'substring',
        optionSet: data?.['option-set'] || optionSetName,
      };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  // --- FASE 2: RESPALDOS Y ACTUALIZACIONES ROUTEROS ---

  /**
   * Genera un respaldo binario completo (.backup) en RouterOS.
   */
  async createBackup(name: string, password?: string): Promise<string> {
    const payload: Record<string, string> = { name };
    if (password) {
      payload.password = password;
    }
    try {
      await this.http.post(this.buildUrl('system/backup/save'), payload, this.buildRequestConfig());
      return name.endsWith('.backup') ? name : `${name}.backup`;
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Genera una exportación de configuración en texto plano (.rsc).
   */
  async exportConfig(file: string, showSensitive = false): Promise<string> {
    const payload: Record<string, string> = { file };
    if (showSensitive) {
      payload['show-sensitive'] = '';
    }
    try {
      await this.http.post(this.buildUrl('export'), payload, this.buildRequestConfig());
      return file.endsWith('.rsc') ? file : `${file}.rsc`;
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Lee un archivo generado en RouterOS en bloques (chunks) de 32KB usando /rest/file/read.
   */
  async readFileChunks(filename: string): Promise<Buffer> {
    const chunkSize = 32768;
    let offset = 0;
    const chunks: Buffer[] = [];

    while (true) {
      try {
        const response = await this.http.post(
          this.buildUrl('file/read'),
          {
            file: filename,
            'chunk-size': String(chunkSize),
            offset: String(offset),
          },
          this.buildRequestConfig(),
        );

        let data = '';
        if (Array.isArray(response.data) && response.data.length > 0) {
          data = response.data[0]?.data ?? '';
        } else if (response.data && typeof response.data.data === 'string') {
          data = response.data.data;
        }

        if (!data || data.length === 0) {
          break;
        }

        const bufferChunk = Buffer.from(data, 'binary');
        chunks.push(bufferChunk);
        offset += bufferChunk.length;

        if (bufferChunk.length < chunkSize) {
          break;
        }
      } catch (error) {
        if (chunks.length > 0) {
          break;
        }
        throw new Error(this.describeError(error));
      }
    }

    if (chunks.length === 0) {
      throw new Error(`El archivo "${filename}" en RouterOS está vacío o no pudo ser leído.`);
    }

    return Buffer.concat(chunks);
  }

  /**
   * Elimina un archivo temporal de RouterOS para no saturar el almacenamiento flash.
   */
  async deleteFile(filename: string): Promise<void> {
    try {
      const response = await this.http.get(this.buildUrl('file'), {
        ...this.buildRequestConfig(),
        params: { name: filename },
      });
      const files = Array.isArray(response.data) ? response.data : [];
      const match = files.find((f: any) => f?.name === filename || f?.name?.endsWith(filename));
      const targetId = match?.['.id'] || filename;

      await this.http.delete(this.buildUrl(`file/${encodeURIComponent(targetId)}`), this.buildRequestConfig());
    } catch {
      // Si falla el borrado del archivo temporal no bloqueamos el flujo principal
    }
  }

  /**
   * Comprueba si hay actualizaciones disponibles de RouterOS (/system/package/update).
   */
  async checkPackageUpdates(): Promise<RouterOsUpdateInfo> {
    try {
      let checkResponse: any;
      try {
        checkResponse = await this.http.post(
          this.buildUrl('system/package/update/check-for-updates'),
          {},
          this.buildRequestConfig(),
        );
      } catch {
        checkResponse = await this.http.get(this.buildUrl('system/package/update'), this.buildRequestConfig());
      }

      const raw = Array.isArray(checkResponse?.data) ? checkResponse.data[0] : checkResponse?.data || {};
      const installed = raw?.['installed-version'] || raw?.installedVersion || '';
      const latest = raw?.['latest-version'] || raw?.latestVersion || installed;
      const channel = raw?.channel || 'stable';
      const status = raw?.status || 'Sin novedades';
      const updateAvailable = Boolean(latest && installed && latest !== installed);

      return {
        channel,
        installedVersion: installed,
        latestVersion: latest,
        status,
        updateAvailable,
      };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  // --- FASE 3: INTERFACES FÍSICAS, POOLS Y LEASES DHCP ---

  /**
   * Obtiene la lista de interfaces físicas y lógicas (/interface).
   */
  async getInterfaces(): Promise<RouterOsInterfaceItem[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('interface'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => ({
      id: entry['.id'] || '',
      name: entry.name || '',
      type: entry.type || 'ether',
      running: entry.running === true || entry.running === 'true',
      disabled: entry.disabled === true || entry.disabled === 'true',
      macAddress: entry['mac-address'],
      mtu: entry.mtu ? parseInt(entry.mtu, 10) : undefined,
      comment: entry.comment,
    }));
  }

  /**
   * Habilita o deshabilita una interfaz en RouterOS.
   */
  async setInterfaceDisabled(nameOrId: string, disabled: boolean): Promise<void> {
    try {
      let targetId = nameOrId;
      if (!nameOrId.startsWith('*')) {
        const response = await this.http.get(this.buildUrl('interface'), {
          ...this.buildRequestConfig(),
          params: { name: nameOrId },
        });
        const results = Array.isArray(response.data) ? response.data : [];
        const match = results.find((i: any) => i?.name === nameOrId);
        if (match?.['.id']) {
          targetId = match['.id'];
        }
      }

      await this.http.patch(
        this.buildUrl(`interface/${encodeURIComponent(targetId)}`),
        { disabled: disabled ? 'true' : 'false' },
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Crea un pool de IPs desacoplado (/ip/pool).
   */
  async createIpPool(name: string, ranges: string): Promise<RouterOsIpPool> {
    try {
      const response = await this.http.put(this.buildUrl('ip/pool'), { name, ranges }, this.buildRequestConfig());
      const data = response.data;
      return { id: data?.['.id'] || '', name: data?.name || name, ranges: data?.ranges || ranges };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Actualiza los rangos de un pool de IPs (/ip/pool).
   */
  async updateIpPool(id: string, ranges: string): Promise<RouterOsIpPool> {
    try {
      await this.http.patch(
        this.buildUrl(`ip/pool/${encodeURIComponent(id)}`),
        { ranges },
        this.buildRequestConfig(),
      );
      return { id, name: '', ranges };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Elimina un pool de IPs (/ip/pool).
   */
  async deleteIpPool(id: string): Promise<void> {
    try {
      await this.http.delete(this.buildUrl(`ip/pool/${encodeURIComponent(id)}`), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Obtiene la lista de concesiones DHCP activas y estáticas (/ip/dhcp-server/lease).
   */
  async getDhcpLeases(): Promise<RouterOsDhcpLease[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('ip/dhcp-server/lease'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => ({
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
  }

  /**
   * Convierte una concesión dinámica en estática en RouterOS.
   */
  async makeDhcpLeaseStatic(leaseId: string, comment?: string): Promise<void> {
    try {
      try {
        await this.http.post(
          this.buildUrl('ip/dhcp-server/lease/make-static'),
          { numbers: leaseId },
          this.buildRequestConfig(),
        );
      } catch {
        await this.http.patch(
          this.buildUrl(`ip/dhcp-server/lease/${encodeURIComponent(leaseId)}`),
          { ...(comment ? { comment } : {}) },
          this.buildRequestConfig(),
        );
      }
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Elimina una concesión DHCP (/ip/dhcp-server/lease).
   */
  async deleteDhcpLease(leaseId: string): Promise<void> {
    try {
      await this.http.delete(
        this.buildUrl(`ip/dhcp-server/lease/${encodeURIComponent(leaseId)}`),
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  // --- FASE 4: ANCHO DE BANDA AVANZADO Y SIMPLE QUEUES ---

  /**
   * Consulta las colas simples activas en el router (/queue/simple).
   */
  async getSimpleQueues(): Promise<RouterOsSimpleQueue[]> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('queue/simple'), this.buildRequestConfig());
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    return results.map((entry: any) => ({
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
  }

  // --- FASE 5: SEGURIDAD, PLANTILLAS FIREWALL Y LOGS EN VIVO ---

  /**
   * Asegura una entrada en /ip/firewall/address-list (idempotente).
   */
  async ensureAddressListEntry(list: string, address: string, comment?: string): Promise<void> {
    try {
      const response = await this.http.get(this.buildUrl('ip/firewall/address-list'), {
        ...this.buildRequestConfig(),
        params: { list, address },
      });
      const results = Array.isArray(response.data) ? response.data : [];
      const match = results.find((e: any) => e?.list === list && e?.address === address);
      if (match) {
        return;
      }
      await this.http.put(
        this.buildUrl('ip/firewall/address-list'),
        { list, address, ...(comment ? { comment } : {}) },
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Remueve entradas de una address-list por su comentario.
   */
  async removeAddressListEntriesByComment(comment: string): Promise<void> {
    try {
      const response = await this.http.get(this.buildUrl('ip/firewall/address-list'), this.buildRequestConfig());
      const results = Array.isArray(response.data) ? response.data : [];
      const matches = results.filter((e: any) => e?.comment === comment);
      for (const match of matches) {
        if (match['.id']) {
          await this.http.delete(
            this.buildUrl(`ip/firewall/address-list/${encodeURIComponent(match['.id'])}`),
            this.buildRequestConfig(),
          );
        }
      }
    } catch {
      // Ignorar si no existe
    }
  }

  /**
   * Remueve reglas del firewall filter por su comentario.
   */
  async removeFilterRulesByComment(comment: string): Promise<void> {
    try {
      const response = await this.http.get(this.buildUrl('ip/firewall/filter'), this.buildRequestConfig());
      const results = Array.isArray(response.data) ? response.data : [];
      const matches = results.filter((r: any) => r?.comment === comment);
      for (const match of matches) {
        if (match['.id']) {
          await this.http.delete(
            this.buildUrl(`ip/firewall/filter/${encodeURIComponent(match['.id'])}`),
            this.buildRequestConfig(),
          );
        }
      }
    } catch {
      // Ignorar si no existe
    }
  }

  /**
   * Consulta el buffer de logs en vivo de RouterOS (/log).
   */
  async getRouterLogs(topics?: string): Promise<RouterOsLogEntry[]> {
    let response;
    try {
      const params: Record<string, string> = {};
      if (topics) {
        params.topics = topics;
      }
      response = await this.http.get(this.buildUrl('log'), {
        ...this.buildRequestConfig(),
        params,
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }
    const results = Array.isArray(response.data) ? response.data : [];
    const mapped = results.map((entry: any) => ({
      id: entry['.id'] || '',
      time: entry.time || '',
      topics: entry.topics || '',
      message: entry.message || '',
    }));
    return mapped.slice(-150).reverse();
  }

  private buildUrl(resourcePath: string): string {
    const scheme = this.config.useHttps === false ? 'http' : 'https';
    return `${scheme}://${this.config.managementIp}:${this.config.apiPort}/rest/${resourcePath}`;
  }

  private buildRequestConfig() {
    const token = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    return {
      headers: { Authorization: `Basic ${token}` },
      timeout: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      httpsAgent: RouterOsClient.insecureHttpsAgent,
    };
  }

  private describeError(error: any): string {
    if (error?.response) {
      return `El nodo respondió con error ${error.response.status}: ${JSON.stringify(error.response.data)}`;
    }
    if (error?.code === 'ECONNABORTED') {
      return 'Tiempo de espera agotado contactando al nodo.';
    }
    if (error?.request) {
      return 'No se pudo contactar al nodo (sin respuesta) — revisa managementIp/apiPort y que la REST API esté habilitada.';
    }
    return error?.message || 'Error desconocido consultando el nodo.';
  }
}
