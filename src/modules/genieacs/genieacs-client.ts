import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';

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
  private readonly logger = new Logger(GenieAcsClient.name);

  /**
   * Paths TR-069 conocidos que exponen una MACAddress/BSSID real del CPE,
   * cubriendo tanto TR-098 (InternetGatewayDevice) como TR-181 (Device) —
   * verificado contra Huawei EG8141A5/HG8546M reales de este tenant, donde
   * `_deviceId._SerialNumber` NO es la MAC (es un serial propio del
   * fabricante tipo "HWTC..."), pero la MAC real del equipo SÍ aparece en
   * estos parámetros de interfaz. Para ONUs EPON/HiOSO cuyo "serial" en
   * Sumtech es en realidad la MAC capturada por la OLT, esto es lo único que
   * permite encontrar el dispositivo real en GenieACS.
   */
  private static readonly MAC_ADDRESS_PATHS = [
    'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress',
    'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.2.MACAddress',
    'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.3.MACAddress',
    'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.4.MACAddress',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.MACAddress',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BSSID',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.MACAddress',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.BSSID',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANEthernetInterfaceConfig.MACAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress',
    'Device.Ethernet.Interface.1.MACAddress',
    'Device.Ethernet.Interface.2.MACAddress',
    'Device.WiFi.SSID.1.MACAddress',
    'Device.WiFi.SSID.2.MACAddress',
  ];

  /**
   * Las distintas interfaces (LAN/WAN/WiFi) de un mismo CPE suelen tener MACs
   * secuenciales (MAC base + 1, +2, ...) asignadas de fábrica — verificado en
   * vivo: la MAC que la OLT HiOSO reportó para un ONU EPON real difería en
   * exactamente 1 del último octeto de la MAC que ese mismo equipo reporta
   * por TR-069. Por eso, como ÚLTIMO recurso (nunca antes de agotar el match
   * exacto), se tantea un corrimiento pequeño sobre el último octeto.
   */
  private static readonly MAC_LAST_OCTET_TOLERANCE = 4;

  /**
   * Timeout para tareas con `connection_request=true` (reboot, factoryReset,
   * setParameterValues, refreshObject, setWifiCredentials): GenieACS espera
   * sincrónicamente la sesión CWMP completa contra el CPE real antes de
   * responder — verificado contra la instancia real que esto tarda bastante
   * más que los 8s del timeout por defecto, incluso cuando la tarea sí se
   * entrega con éxito.
   */
  private static readonly CONNECTION_REQUEST_TIMEOUT_MS = 30000;

  constructor(
    private readonly config: GenieAcsClientConfig,
    private readonly http: Pick<AxiosInstance, 'get' | 'post' | 'delete'> = axios,
  ) {}

  /**
   * Busca el deviceId de GenieACS cuyo serial TR-069 coincida con el serial
   * físico del equipo (capturado por el técnico en inv.serial_numbers al
   * instalar), con dos niveles de respaldo si ese match exacto falla:
   *
   * 1. `_deviceId._SerialNumber` exacto (comportamiento original — cubre
   *    equipos cuyo "serial" en Sumtech ya es el identificador real que el
   *    CPE reporta a GenieACS).
   * 2. Si el valor tiene forma de dirección MAC: búsqueda exacta (tolerante a
   *    mayúsculas y separador `:`/`-`/ninguno) contra los parámetros
   *    MACAddress/BSSID reales del árbol TR-069 — necesario para ONUs
   *    EPON/HiOSO cuyo "serial" en Sumtech en realidad es la MAC que reportó
   *    la OLT, mientras que GenieACS identifica al equipo por un serial de
   *    fábrica distinto (verificado contra Huawei EG8141A5/HG8546M reales).
   * 3. Último recurso: la misma búsqueda de MAC, pero tolerando un corrimiento
   *    de hasta `MAC_LAST_OCTET_TOLERANCE` en el último octeto — las
   *    distintas interfaces de un mismo equipo suelen tener MACs secuenciales,
   *    y la MAC que capturó la OLT puede no ser la misma interfaz que reporta
   *    el propio CPE por TR-069. Un match aquí se loguea como aproximado: no
   *    es tan confiable como los dos anteriores y conviene poder auditarlo.
   *
   * Devuelve null solo si NINGUNO de los tres niveles encuentra nada — en ese
   * caso sí es correcto asumir que el CPE nunca hizo bootstrap contra este
   * GenieACS. No es un error, es un estado válido y esperable.
   */
  async findDeviceBySerial(serialNumber: string): Promise<string | null> {
    const bySerial = await this.queryFirstDeviceId({ '_deviceId._SerialNumber': serialNumber });
    if (bySerial) {
      return bySerial;
    }

    const macOctets = parseMacOctets(serialNumber);
    if (!macOctets) {
      return null;
    }

    const byExactMac = await this.findDeviceByMacHexCandidates([macOctets.join('')]);
    if (byExactMac) {
      return byExactMac;
    }

    const nearbyHexCandidates = buildNearbyMacHexCandidates(macOctets, GenieAcsClient.MAC_LAST_OCTET_TOLERANCE);
    const byNearbyMac = await this.findDeviceByMacHexCandidates(nearbyHexCandidates);
    if (byNearbyMac) {
      this.logger.warn(
        `CPE "${serialNumber}" no tiene match exacto de serial ni de MAC en GenieACS; se emparejó por aproximación ` +
          `(±${GenieAcsClient.MAC_LAST_OCTET_TOLERANCE} en el último octeto de la MAC) contra el deviceId "${byNearbyMac}". ` +
          `Confirmar manualmente que corresponde al mismo equipo físico.`,
      );
    }
    return byNearbyMac;
  }

  /**
   * Busca, entre `MAC_ADDRESS_PATHS`, el primer dispositivo cuyo valor de
   * alguno de esos parámetros matchee (exacto, sin importar mayúsculas ni
   * separador) cualquiera de los `hexCandidates` provistos (cada uno, 12
   * dígitos hex sin separadores). `[]` o ningún match -> null, sin pegarle a
   * la NBI innecesariamente.
   */
  private async findDeviceByMacHexCandidates(hexCandidates: string[]): Promise<string | null> {
    if (hexCandidates.length === 0) {
      return null;
    }
    const orClauses = GenieAcsClient.MAC_ADDRESS_PATHS.flatMap((path) =>
      hexCandidates.map((hex) => ({
        [`${path}._value`]: { $regex: macHexToPattern(hex), $options: 'i' },
      })),
    );
    return this.queryFirstDeviceId({ $or: orClauses });
  }

  private async queryFirstDeviceId(query: Record<string, unknown>): Promise<string | null> {
    let response;
    try {
      response = await this.http.get(this.buildUrl('devices'), {
        ...this.buildRequestConfig(),
        params: { query: JSON.stringify(query) },
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
    // En TR-098, los Huawei EchoLife/EPON de este tenant (BeaconType
    // "WPAand11i", modo mixto WPA/WPA2) rechazan con fault 9007 cualquier
    // escritura directa a WLANConfiguration.{i}.KeyPassphrase -- verificado
    // contra ambas ONUs reales. El nodo que sí aceptan sin fault es el de la
    // rama PreSharedKey (WLANConfiguration.{i}.PreSharedKey.1.KeyPassphrase),
    // pero aceptarlo SIN fault no implica que el radio lo aplique: verificado
    // en vivo que el cliente real sigue sin poder conectarse con la clave
    // "nueva" hasta que además se entrega el PSK ya derivado en hexadecimal
    // (PreSharedKey.1.PreSharedKey, ver computeWpaPsk) y el equipo se
    // reinicia -- un simple Enable=false/true del radio NO alcanza, hace
    // falta el reboot completo (probado: la clave hex sola bastó, no fue
    // necesario repetir con ambos cambios en requests separados).
    const parameterValues: Array<[string, string, string]> = isTR181
      ? [
          ['Device.WiFi.SSID.1.SSID', credentials.ssid, 'xsd:string'],
          ['Device.WiFi.AccessPoint.1.Security.KeyPassphrase', credentials.password, 'xsd:string'],
        ]
      : [
          ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', credentials.ssid, 'xsd:string'],
          [
            'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase',
            credentials.password,
            'xsd:string',
          ],
          [
            'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
            computeWpaPsk(credentials.ssid, credentials.password),
            'xsd:string',
          ],
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
          : [
              'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase',
              credentials.password,
              'xsd:string',
            ],
      );
      if (!isTR181) {
        parameterValues.push([
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.PreSharedKey',
          computeWpaPsk(credentials.ssid5g, credentials.password),
          'xsd:string',
        ]);
      }
    }

    try {
      const taskResponse = await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        { name: 'setParameterValues', parameterValues },
        this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS),
      );
      await this.assertTaskSucceeded(deviceId, (taskResponse as any).data?._id);

      await this.http.post(
        this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tags/WIFI_CUSTOMIZED`),
        {},
        this.buildRequestConfig(),
      );

      if (!isTR181) {
        // El radio no recarga el PSK nuevo solo con el SetParameterValues de
        // arriba -- probado en vivo que ni siquiera un Enable=false/true del
        // WLANConfiguration alcanza, hace falta el reboot completo del CPE.
        // Best-effort: si el reboot falla no se revierte el cambio (la clave
        // ya quedó guardada), solo se registra para que soporte lo reintente.
        try {
          await this.rebootDevice(deviceId);
        } catch (rebootError) {
          this.logger.warn(
            `La clave WiFi de ${deviceId} se guardó pero el reinicio automático falló: ${this.describeError(rebootError)}. El cliente seguirá con la clave anterior hasta reiniciar el equipo manualmente.`,
          );
        }
      }
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * `connection_request=true` responde 2xx en cuanto GenieACS logra abrir la
   * sesión CWMP contra el CPE — eso NO significa que la tarea en sí haya
   * tenido éxito: un `SetParameterValues` puede volver con un fault (ej.
   * 9007 "Invalid parameter value" cuando el CPE rechaza una clave WiFi por
   * no cumplir su política de complejidad) y GenieACS igual responde 200,
   * porque la sesión como tal sí se completó. Verificado contra la
   * instancia real: sin este chequeo, un rechazo del equipo queda reportado
   * como éxito silencioso. GenieACS registra el fault en `/faults` con id
   * `<deviceId>:task_<taskId>` — si existe, la tarea falló de verdad.
   */
  private async assertTaskSucceeded(deviceId: string, taskId?: string): Promise<void> {
    if (!taskId) {
      return;
    }
    const faultId = `${deviceId}:task_${taskId}`;
    const response = await this.http.get(this.buildUrl('faults'), {
      ...this.buildRequestConfig(),
      params: { query: JSON.stringify({ _id: faultId }) },
    });
    const faults = Array.isArray(response.data) ? response.data : [];
    if (faults.length === 0) {
      return;
    }
    const fault = faults[0];
    const paramFault = fault?.detail?.setParameterValuesFault?.[0];
    const reason = paramFault?.faultString || fault?.message || 'el equipo rechazó el cambio';
    throw new Error(`El equipo rechazó el cambio (${reason}).`);
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
        this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Consulta lista de dispositivos con filtro opcional de GenieACS */
  async getDevices(options?: { query?: any; limit?: number }): Promise<any[]> {
    try {
      const params: any = {};
      if (options?.query) {
        params.query = typeof options.query === 'string' ? options.query : JSON.stringify(options.query);
      }
      if (options?.limit) {
        params.limit = options.limit;
      }
      const response = await this.http.get(this.buildUrl('devices'), {
        ...this.buildRequestConfig(),
        params,
      });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Aplica un conjunto arbitrario de parámetros TR-069 via setParameterValues */
  async setParameterValues(deviceId: string, parameterValues: Array<[string, string, string]>): Promise<void> {
    try {
      await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        { name: 'setParameterValues', parameterValues },
        this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Consulta y verifica valores de parámetros TR-069 del CPE */
  async getParameterValues(deviceId: string, parameterNames: string[]): Promise<Record<string, string | undefined>> {
    try {
      // 1. Obtener documento actual del dispositivo
      const response = await this.http.get(this.buildUrl('devices'), {
        ...this.buildRequestConfig(),
        params: { query: JSON.stringify({ _id: deviceId }) },
      });
      const results = Array.isArray(response.data) ? response.data : [];
      if (results.length === 0) {
        throw new Error(`GenieACS no tiene ningún dispositivo con el id "${deviceId}".`);
      }
      const doc = results[0];
      const result: Record<string, string | undefined> = {};
      for (const name of parameterNames) {
        result[name] = getParamValue(doc, name);
      }
      return result;
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Refresca un objeto o parámetro en el CPE vía getParameterValues task */
  async refreshObject(deviceId: string, objectPath: string = ''): Promise<void> {
    try {
      const parameterNames = objectPath ? [objectPath] : ['Device.', 'InternetGatewayDevice.'];
      await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        { name: 'getParameterValues', parameterNames },
        this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Restablece los valores de fábrica del CPE (FactoryReset TR-069) */
  async factoryReset(deviceId: string): Promise<void> {
    try {
      await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        { name: 'factoryReset' },
        this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Asigna un tag al dispositivo en GenieACS */
  async setDeviceTag(deviceId: string, tagName: string): Promise<void> {
    try {
      await this.http.post(
        this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tags/${encodeURIComponent(tagName)}`),
        {},
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Remueve un tag del dispositivo en GenieACS */
  async deleteDeviceTag(deviceId: string, tagName: string): Promise<void> {
    try {
      await this.http.delete(
        this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tags/${encodeURIComponent(tagName)}`),
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  private buildUrl(resourcePath: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    if (base.includes(':7557')) {
      return `${base}/${resourcePath}/`;
    }
    if (base.endsWith('/api/v1')) {
      return `${base}/${resourcePath}/`;
    }
    return `${base}/api/v1/${resourcePath}/`;
  }

  /**
   * timeoutMs por defecto (8s): correcto para lecturas simples contra la
   * propia base de GenieACS. Las llamadas con `connection_request=true`
   * esperan sincrónicamente a que GenieACS complete todo el intercambio
   * CWMP real contra el CPE (auth digest, entrega de la tarea, cierre de
   * sesión) — 8s se queda corto ahí y revienta con un 500 genérico aunque
   * la tarea igual se haya encolado y vaya a aplicar en la próxima sesión.
   * Ver CONNECTION_REQUEST_TIMEOUT_MS para esos casos.
   */
  private buildRequestConfig(overrideTimeoutMs?: number) {
    return {
      headers: { 'X-API-Key': this.config.apiKey },
      timeout: overrideTimeoutMs ?? this.config.timeoutMs ?? 8000,
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

/**
 * Si `value` tiene forma de dirección MAC (12 dígitos hex, con separador
 * `:`/`-`/ninguno, sin importar mayúsculas), devuelve sus 6 octetos en
 * minúscula (ej. ['b4','54','59','6f','12','04']). Si no, devuelve null —
 * así el llamador sabe que no vale la pena intentar un match por MAC (ej. un
 * serial de fábrica real tipo "HWTC..." nunca tiene esta forma).
 */
function parseMacOctets(value: string): string[] | null {
  const hex = (value || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12) {
    return null;
  }
  return hex.match(/.{2}/g) as string[];
}

/**
 * Construye, a partir de los 6 octetos de una MAC, las variantes donde el
 * último octeto se desplaza en ±1..±tolerance (excluyendo el valor exacto,
 * que ya se intentó antes de llamar a esto). Cada candidato es un string de
 * 12 dígitos hex sin separadores, listo para `macHexToPattern`.
 */
function buildNearbyMacHexCandidates(octets: string[], tolerance: number): string[] {
  const prefix = octets.slice(0, 5).join('');
  const lastOctetValue = parseInt(octets[5], 16);
  const candidates: string[] = [];
  for (let delta = -tolerance; delta <= tolerance; delta++) {
    if (delta === 0) continue;
    const candidateValue = lastOctetValue + delta;
    if (candidateValue < 0 || candidateValue > 255) continue;
    candidates.push(prefix + candidateValue.toString(16).padStart(2, '0'));
  }
  return candidates;
}

/**
 * Convierte 12 dígitos hex de una MAC (sin separadores) a un patrón regex
 * (string, para usar con `$regex` de Mongo) que matchea esa MAC sin importar
 * si el CPE la reportó con `:`, `-` o sin separador entre octetos. El
 * `$options: 'i'` en el llamador se encarga de la insensibilidad a mayúsculas.
 */
function macHexToPattern(hex: string): string {
  const octets = hex.match(/.{2}/g) as string[];
  return '^' + octets.join('[:-]?') + '$';
}

function parseOpticalRxPower(rawValue: string | undefined): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  const parsed = parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Deriva el PSK WPA2 en hexadecimal (256 bits) a partir del passphrase ASCII
 * y el SSID, según el estándar 802.11i (PBKDF2-HMAC-SHA1, 4096 iteraciones,
 * SSID como salt). Necesario porque los Huawei EchoLife/EPON de este tenant
 * (BeaconType "WPAand11i") no derivan el PSK ellos mismos al recibir el
 * passphrase por TR-069 -- aceptan la escritura sin fault pero el radio
 * sigue usando la clave vieja hasta que se les entrega también el PSK ya
 * calculado. Verificado en vivo: sin esto, el cliente real no logra
 * conectarse con la contraseña "nueva" pese a que GenieACS no reporta error.
 */
function computeWpaPsk(ssid: string, password: string): string {
  return crypto.pbkdf2Sync(password, ssid, 4096, 32, 'sha1').toString('hex');
}
