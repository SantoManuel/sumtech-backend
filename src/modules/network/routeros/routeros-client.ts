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
}

export interface RouterOsConnectionResult {
  ok: boolean;
  error?: string;
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
    private readonly http: Pick<AxiosInstance, 'get' | 'put' | 'patch' | 'delete'> = axios,
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
    };
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
      };
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Actualiza los atributos de un perfil PPP existente. */
  async updateProfile(
    profileId: string,
    rateLimit: string,
    options?: EnsureProfileOptions,
  ): Promise<void> {
    const payload: Record<string, string> = {
      'rate-limit': rateLimit,
    };
    if (options?.parentQueue !== undefined) payload['parent-queue'] = options.parentQueue;
    if (options?.localAddress !== undefined) payload['local-address'] = options.localAddress;
    if (options?.remoteAddress !== undefined) payload['remote-address'] = options.remoteAddress;
    if (options?.onlyOne !== undefined) payload['only-one'] = options.onlyOne ? 'yes' : 'no';

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
      (options?.remoteAddress && existing.remoteAddress !== options.remoteAddress);

    if (needsUpdate) {
      await this.updateProfile(existing.id, rateLimit, options);
    }

    return {
      ...existing,
      rateLimit,
      parentQueue: options?.parentQueue ?? existing.parentQueue,
      localAddress: options?.localAddress ?? existing.localAddress,
      remoteAddress: options?.remoteAddress ?? existing.remoteAddress,
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
