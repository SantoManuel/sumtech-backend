import axios, { AxiosInstance } from 'axios';
import * as https from 'https';

export interface GenieAcsClientConfig {
  /** Base de la NBI detrás de nginx, ej. "https://genieacs.sumtech.local" — SIN "/api/v1" al final. */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface GenieAcsDeviceStatus {
  deviceId: string;
  isTR181: boolean;
  lastInformAt?: Date;
  registeredAt?: Date;
  manufacturer?: string;
  serialNumber?: string;
  ssid?: string;
  ssid5g?: string;
  opticalRxPowerDbm?: number;
}

export interface WifiCredentialsInput {
  /** 1–32 caracteres — límite real de un SSID 802.11. */
  ssid: string;
  /** Si el CPE no expone una segunda radio, se ignora silenciosamente (no revienta). */
  ssid5g?: string;
  /** 8–63 caracteres ASCII imprimibles — rango válido de una passphrase WPA2/WPA3. */
  password: string;
}

/**
 * Cliente contra la NBI REST de GenieACS (v1.2.x), siempre a través del
 * nginx del propio servidor (nunca directo al puerto 7557) — así se respeta
 * la validación de API Key y TLS que ya trae ese stack. Verificado
 * empíricamente contra un GenieACS 1.2.9 real (Fase 00):
 * - El `_id` de un dispositivo puede contener caracteres '%' literales (ej.
 *   "00259E-EchoLife%20HG8245H5-16") — SIEMPRE hay que `encodeURIComponent()`
 *   el `_id` tal cual vino de la NBI antes de usarlo en un path, incluso si
 *   ya "parece" estar codificado.
 * - Los documentos de dispositivo son un árbol anidado que replica el path
 *   TR-069 (ej. `doc.InternetGatewayDevice.LANDevice["1"].WLANConfiguration["1"].SSID._value`),
 *   no un mapa plano de claves con puntos.
 */
export class GenieAcsClient {
  // Certificado autofirmado del servidor GenieACS de Sumtech (ver Fase 00) —
  // no es una recomendación general, es la realidad operativa de este stack.
  private static readonly insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

  constructor(
    private readonly config: GenieAcsClientConfig,
    private readonly http: Pick<AxiosInstance, 'get' | 'post' | 'delete'> = axios,
  ) {}

  /**
   * Busca el deviceId de GenieACS cuyo serial TR-069 coincida con el serial
   * físico del equipo (capturado por el técnico en inv.serial_numbers al
   * instalar). Devuelve null si el CPE nunca hizo bootstrap contra este
   * GenieACS todavía — no es un error, es un estado válido y esperable.
   */
  async findDeviceBySerial(serialNumber: string): Promise<string | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('devices'), {
        ...this.buildRequestConfig(),
        params: { query: JSON.stringify({ '_deviceId._SerialNumber': serialNumber }) },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    if (results.length === 0) {
      return null;
    }
    return results[0]._id;
  }

  /** Devuelve el estado cacheado (telemetría + SSID actual) de un dispositivo ya conocido. */
  async getDeviceStatus(deviceId: string): Promise<GenieAcsDeviceStatus> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('devices'), {
        ...this.buildRequestConfig(),
        params: { query: JSON.stringify({ _id: deviceId }) },
      });
    } catch (error) {
      throw new Error(this.describeError(error));
    }

    const results = Array.isArray(response.data) ? response.data : [];
    if (results.length === 0) {
      throw new Error(`GenieACS no tiene ningún dispositivo con el id "${deviceId}".`);
    }

    const doc = results[0];
    const isTR181 = doc.Device !== undefined;

    return {
      deviceId: doc._id,
      isTR181,
      lastInformAt: doc._lastInform ? new Date(doc._lastInform) : undefined,
      registeredAt: doc._registered ? new Date(doc._registered) : undefined,
      manufacturer: doc._deviceId?._Manufacturer,
      serialNumber: doc._deviceId?._SerialNumber,
      ssid: isTR181
        ? getParamValue(doc, 'Device.WiFi.SSID.1.SSID')
        : getParamValue(doc, 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID'),
      ssid5g: isTR181
        ? getParamValue(doc, 'Device.WiFi.SSID.2.SSID')
        : getParamValue(doc, 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID'),
      opticalRxPowerDbm: parseOpticalRxPower(
        isTR181
          ? getParamValue(doc, 'Device.Optical.Interface.1.OpticalSignalLevel')
          : getParamValue(doc, 'InternetGatewayDevice.WANDevice.1.WANDSLInterfaceConfig.X_Sumtech_OpticalRxPower'),
      ),
    };
  }

  /**
   * Aplica un SSID/clave nuevos directamente sobre los parámetros reales del
   * CPE (setParameterValues + connection_request), y marca
   * Tags.WIFI_CUSTOMIZED=true para que el provisioning automático del plan
   * (ver default_wan_wifi.js, Fase 00) deje de pisar estos valores en el
   * próximo Inform periódico. isTR181 decide el árbol de parámetros a usar —
   * quien llama debe resolverlo antes (ver GenieAcsDeviceResolverService).
   */
  async setWifiCredentials(deviceId: string, isTR181: boolean, credentials: WifiCredentialsInput): Promise<void> {
    const parameterValues: Array<[string, string, string]> = isTR181
      ? [
          ['Device.WiFi.SSID.1.SSID', credentials.ssid, 'xsd:string'],
          ['Device.WiFi.AccessPoint.1.Security.KeyPassphrase', credentials.password, 'xsd:string'],
        ]
      : [
          ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', credentials.ssid, 'xsd:string'],
          ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase', credentials.password, 'xsd:string'],
        ];

    if (credentials.ssid5g) {
      parameterValues.push(
        isTR181
          ? ['Device.WiFi.SSID.2.SSID', credentials.ssid5g, 'xsd:string']
          : ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID', credentials.ssid5g, 'xsd:string'],
      );
      parameterValues.push(
        isTR181
          ? ['Device.WiFi.AccessPoint.2.Security.KeyPassphrase', credentials.password, 'xsd:string']
          : ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase', credentials.password, 'xsd:string'],
      );
    }

    try {
      await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        { name: 'setParameterValues', parameterValues },
        this.buildRequestConfig(),
      );
      await this.http.post(
        this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tags/WIFI_CUSTOMIZED`),
        {},
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Quita la personalización de WiFi (soporte/cliente pide "restaurar de
   * fábrica"): borra el tag, así el próximo Inform periódico vuelve a aplicar
   * el SSID/clave determinísticos del plan.
   */
  async clearWifiCustomization(deviceId: string): Promise<void> {
    try {
      await this.http.delete(
        this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tags/WIFI_CUSTOMIZED`),
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Reinicia el CPE de forma remota. El cliente se queda sin internet ~60s. */
  async rebootDevice(deviceId: string): Promise<void> {
    try {
      await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        { name: 'reboot' },
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  private buildUrl(resourcePath: string): string {
    return `${this.config.baseUrl}/api/v1/${resourcePath}/`;
  }

  private buildRequestConfig() {
    return {
      headers: { 'X-API-Key': this.config.apiKey },
      timeout: this.config.timeoutMs ?? 8000,
      httpsAgent: GenieAcsClient.insecureHttpsAgent,
    };
  }

  private describeError(error: any): string {
    if (error?.response) {
      return `GenieACS respondió con error ${error.response.status}: ${JSON.stringify(error.response.data)}`;
    }
    if (error?.code === 'ECONNABORTED') {
      return 'Tiempo de espera agotado contactando al servidor GenieACS.';
    }
    if (error?.request) {
      return 'No se pudo contactar al servidor GenieACS (sin respuesta) — revisa GENIEACS_NBI_BASE_URL.';
    }
    return error?.message || 'Error desconocido consultando GenieACS.';
  }
}

/**
 * Navega el árbol anidado que devuelve la NBI (ej. `{InternetGatewayDevice:
 * {LANDevice: {"1": {WLANConfiguration: {"1": {SSID: {_value: "..."}}}}}}}`)
 * siguiendo un path con puntos, y devuelve el `_value` de la hoja — o
 * `undefined` si el CPE nunca reportó ese parámetro (ej. una sola radio WiFi).
 */
function getParamValue(doc: any, dotPath: string): string | undefined {
  const segments = dotPath.split('.');
  let node = doc;
  for (const segment of segments) {
    if (node === null || typeof node !== 'object') {
      return undefined;
    }
    node = node[segment];
  }
  return node && typeof node === 'object' ? node._value : undefined;
}

function parseOpticalRxPower(rawValue: string | undefined): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const parsed = parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}
