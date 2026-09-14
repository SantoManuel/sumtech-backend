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
}

export interface RouterOsPppProfile {
  /** El ".id" interno de RouterOS (ej. "*1") — necesario para poder hacer PATCH sobre este perfil puntual. */
  id: string;
  name: string;
  /** Formato RouterOS "rx-rate/tx-rate", ej. "50M/50M". */
  rateLimit?: string;
}

export interface RouterOsConnectionResult {
  ok: boolean;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Cliente contra la REST API de RouterOS v7+ (`/rest/...`).
 *
 * Disciplina de escritura, deliberada y acotada:
 * - Secretos PPP (clientes): solo se habilitan/deshabilitan (`setPppSecretDisabled`)
 *   y se les puede reasignar el perfil (`setPppSecretProfile`) — nunca se
 *   crean ni se borran. Crear uno requeriría decidir la política de pool de
 *   IP (no decidida); borrar uno es destructivo y no hace falta (deshabilitar
 *   ya logra el objetivo real de forma reversible). Ver Fase 06.
 * - Perfiles PPP (velocidad): SÍ se crean y actualizan (`ensureProfile`) —
 *   es infraestructura compartida y de bajo riesgo (un perfil sin ningún
 *   secreto asignado no afecta a nadie). Nunca se borran: un perfil huérfano
 *   es inofensivo, borrar uno que otro secreto todavía referencia no lo es.
 *   Ver Fase 07.
 */
export class RouterOsClient {
  // Un solo Agent HTTPS reutilizado, con rejectUnauthorized:false porque el
  // certificado autofirmado de fábrica del Mikrotik es la norma, no la
  // excepción, en despachos de campo — no es una recomendación general de
  // seguridad, es la realidad operativa de este tipo de equipo.
  private static readonly insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

  constructor(
    private readonly config: RouterOsClientConfig,
    private readonly http: Pick<AxiosInstance, 'get' | 'put' | 'patch'> = axios,
  ) {}

  async testConnection(): Promise<RouterOsConnectionResult> {
    try {
      await this.http.get(this.buildUrl('system/identity'), this.buildRequestConfig());
      return { ok: true };
    } catch (error) {
      return { ok: false, error: this.describeError(error) };
    }
  }

  /** Devuelve null si el nodo no tiene ningún secreto PPP con ese nombre — no es un error, es una comparación válida (drift). */
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
      // RouterOS ha devuelto este campo como string ("true"/"false") en
      // algunas versiones de la REST API y como boolean nativo en otras.
      disabled: match.disabled === true || match.disabled === 'true',
      profile: match.profile,
      service: match.service,
    };
  }

  /**
   * Habilita/deshabilita un secreto PPP ya existente (identificado por su
   * ".id" de RouterOS, obtenido vía findPppSecretByName). No crea, no borra.
   */
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

  /** Reasigna el perfil (velocidad) de un secreto PPP ya existente. No crea, no borra el secreto. */
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

    return { id: match['.id'], name: match.name, rateLimit: match['rate-limit'] };
  }

  /**
   * Crea un perfil PPP nuevo con el rate-limit indicado.
   *
   * Usa PUT, no POST: verificado empíricamente contra un Mikrotik real
   * (RouterOS 7.23.5) — esta versión de la REST API responde "no such
   * command" (400) a un POST de creación en cualquier menú (se confirmó
   * también contra /ppp/secret), y crea el recurso correctamente con PUT.
   */
  async createProfile(name: string, rateLimit: string): Promise<RouterOsPppProfile> {
    let response;
    try {
      response = await this.http.put(
        this.buildUrl('ppp/profile'),
        { name, 'rate-limit': rateLimit },
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const created = response.data;
    return { id: created?.['.id'], name: created?.name ?? name, rateLimit: created?.['rate-limit'] ?? rateLimit };
  }

  /** Actualiza el rate-limit de un perfil PPP ya existente. */
  async updateProfileRateLimit(profileId: string, rateLimit: string): Promise<void> {
    try {
      await this.http.patch(
        this.buildUrl(`ppp/profile/${encodeURIComponent(profileId)}`),
        { 'rate-limit': rateLimit },
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Garantiza que exista, en este nodo, un perfil con este nombre y este
   * rate-limit — sin importar si ya existía o no. Idempotente: si ya existe
   * con el mismo rate-limit, no hace ningún PATCH innecesario. Nunca borra
   * un perfil, ni siquiera uno que quedó con un rate-limit distinto.
   */
  async ensureProfile(name: string, rateLimit: string): Promise<RouterOsPppProfile> {
    const existing = await this.findProfileByName(name);
    if (!existing) {
      return this.createProfile(name, rateLimit);
    }
    if (existing.rateLimit === rateLimit) {
      return existing;
    }
    await this.updateProfileRateLimit(existing.id, rateLimit);
    return { ...existing, rateLimit };
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
