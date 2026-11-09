import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';

export interface GenieAcsClientConfig {
  wanWriteGuard?: <T>(deviceId: string, paths: string[], action: () => Promise<T>) => Promise<T>;
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
  /** Tags reales del dispositivo en GenieACS (ej. "tenant:sumtech", "olt:OLT_Tabara_Abajo") -- ver setDeviceTag/deleteDeviceTag. */
  tags: string[];
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
 * Fault real de TR-069 `SetParameterValues` (GenieACS `/faults`), con el
 * nombre de CADA parámetro rechazado -- no solo el primero. Permite al
 * llamador (ver `setWifiCredentials`) decidir si un fault puntual admite
 * reintento (ej. el equipo rechaza el PSK precalculado pero el resto del
 * lote era válido) en vez de tratar cualquier fault como fatal.
 */
export class SetParameterValuesFaultError extends Error {
  constructor(public readonly faultedParameters: string[], message: string) {
    super(message);
    this.name = 'SetParameterValuesFaultError';
  }
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
  async findDeviceBySerial(serialNumber: string, options?: { exactOnly: boolean }): Promise<string | null> {
    const candidates = buildSerialCandidates(serialNumber);

    // Si solo hay un candidato y es corto (ej. serial simple '16'), consulta directa clásica
    if (candidates.length === 1 && serialNumber.length < 12) {
      const bySerial = await this.queryFirstDeviceId({ '_deviceId._SerialNumber': serialNumber }, options?.exactOnly);
      if (bySerial) {
        return bySerial;
      }
    } else {
      // Búsqueda multi-variante GPON (coincidencia exacta por _deviceId._SerialNumber o sufijo en _id)
      const orClauses: Array<Record<string, unknown>> = candidates.flatMap((c) => [
        { '_deviceId._SerialNumber': c },
        { _id: { $regex: `${c}$`, $options: 'i' } },
      ]);
      const bySerial = await this.queryFirstDeviceId({ $or: orClauses }, options?.exactOnly);
      if (bySerial) {
        return bySerial;
      }
    }

    const macOctets = parseMacOctets(serialNumber);
    if (!macOctets) {
      return null;
    }

    const byExactMac = await this.findDeviceByMacHexCandidates([macOctets.join('')], options?.exactOnly);
    if (byExactMac) {
      return byExactMac;
    }
    if (options?.exactOnly) return null;

    const nearbyLastOctetHexValues = buildNearbyLastOctetHexValues(macOctets[5], GenieAcsClient.MAC_LAST_OCTET_TOLERANCE);
    const byNearbyMac = await this.findDeviceByMacPrefixAndLastOctets(macOctets.slice(0, 5), nearbyLastOctetHexValues);
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
  private async findDeviceByMacHexCandidates(hexCandidates: string[], requireUnique = false): Promise<string | null> {
    if (hexCandidates.length === 0) {
      return null;
    }
    const orClauses = GenieAcsClient.MAC_ADDRESS_PATHS.flatMap((path) =>
      hexCandidates.map((hex) => ({
        [`${path}._value`]: { $regex: macHexToPattern(hex), $options: 'i' },
      })),
    );
    return this.queryFirstDeviceId({ $or: orClauses }, requireUnique);
  }

  /**
   * Variante del fallback por MAC para el nivel de tolerancia: en vez de
   * repetir la MAC completa por cada candidato (como hacía la primera versión
   * de este fix, que generaba `paths × candidatos` cláusulas y provocó un 431
   * "Request Header Fields Too Large" real contra la NBI de producción —
   * 15 paths × 8 candidatos = 120 cláusulas en una sola query GET), arma UNA
   * sola cláusula por path cuyo regex fija el prefijo común (los primeros 5
   * octetos, que no cambian) y alterna solo los 1-2 dígitos del último octeto.
   * El tamaño de la query queda así en O(paths) en vez de O(paths × tolerancia).
   */
  private async findDeviceByMacPrefixAndLastOctets(
    prefixOctets: string[],
    lastOctetHexValues: string[],
  ): Promise<string | null> {
    if (lastOctetHexValues.length === 0) {
      return null;
    }
    const prefixPattern = prefixOctets.join('[:-]?');
    const lastOctetAlternation = lastOctetHexValues.join('|');
    const pattern = `^${prefixPattern}[:-]?(?:${lastOctetAlternation})$`;
    const orClauses = GenieAcsClient.MAC_ADDRESS_PATHS.map((path) => ({
      [`${path}._value`]: { $regex: pattern, $options: 'i' },
    }));
    return this.queryFirstDeviceId({ $or: orClauses });
  }

  private async queryFirstDeviceId(query: Record<string, unknown>, requireUnique = false): Promise<string | null> {
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
    if (requireUnique && results.length !== 1) throw new Error('La identidad del CPE es ambigua en GenieACS.');
    return results[0]._id;
  }

  /** Obtiene el documento crudo de un dispositivo en GenieACS. */
  async getDeviceDocument(deviceId: string): Promise<any> {
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

    return results[0];
  }

  /** Devuelve el estado cacheado (telemetría + SSID actual) de un dispositivo ya conocido. */
  async getDeviceStatus(deviceId: string): Promise<GenieAcsDeviceStatus> {
    const doc = await this.getDeviceDocument(deviceId);
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
      tags: Array.isArray(doc._tags) ? doc._tags : [],
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
    //
    // CORRECCIÓN (2026-10-25): ese hallazgo NO generaliza a todo TR-098 --
    // CONFIRMADO EN VIVO contra GenieACS de producción (deviceId
    // "987DDD-HG8546M%2DXPON-CMDCDD4D131E", fault real capturado en
    // /faults): este Huawei HG8546M-XPON rechaza el PSK precalculado con
    // "%Code 9007: Invalid parameter value" en AMBAS bandas
    // (WLANConfiguration.1 y .2), tumbando el lote completo de
    // SetParameterValues (incluido el SSID y el KeyPassphrase, que sí eran
    // válidos -- confirmado que el cliente SÍ pudo guardar el KeyPassphrase
    // a mano desde la UI de GenieACS, sin tocar el PSK). Este equipo deriva
    // el PSK internamente a partir del passphrase -- comportamiento WPA2
    // estándar -- y tratar el PSK precalculado como obligatorio para TODO
    // TR-098 rompía exactamente a los equipos que SÍ lo soportan bien.
    // Mitigación: primer intento con el PSK precalculado (preserva el
    // comportamiento ya verificado para los EchoLife/EPON viejos); si el
    // único fault reportado es sobre "PreSharedKey.1.PreSharedKey", se
    // reintenta sin ese parámetro -- ver buildWifiParameterValues() y el
    // catch de abajo.
    const parameterValues = this.buildWifiParameterValues(isTR181, credentials, true);

    try {
      await this.sendSetParameterValues(deviceId, parameterValues);
    } catch (error) {
      if (error instanceof SetParameterValuesFaultError && !isTR181 && this.isOnlyPreSharedKeyFault(error)) {
        this.logger.warn(
          `${deviceId}: el equipo rechazó el PSK WPA precalculado (${error.faultedParameters.join(', ')}) -- reintentando sin él, el equipo lo derivará internamente del passphrase.`,
        );
        const fallbackParameterValues = this.buildWifiParameterValues(isTR181, credentials, false);
        try {
          await this.sendSetParameterValues(deviceId, fallbackParameterValues);
        } catch (retryError) {
          throw new Error(this.describeError(retryError));
        }
      } else {
        throw new Error(this.describeError(error));
      }
    }

    try {
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
   * Arma el lote de parámetros TR-069 para el cambio de WiFi.
   * `includePrecomputedPsk=false` omite "PreSharedKey.1.PreSharedKey" --
   * usado en el reintento cuando el equipo ya demostró que lo rechaza (ver
   * setWifiCredentials()).
   */
  private buildWifiParameterValues(
    isTR181: boolean,
    credentials: WifiCredentialsInput,
    includePrecomputedPsk: boolean,
  ): Array<[string, string, string]> {
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
        ];

    if (!isTR181 && includePrecomputedPsk) {
      parameterValues.push([
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
        computeWpaPsk(credentials.ssid, credentials.password),
        'xsd:string',
      ]);
    }

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
      if (!isTR181 && includePrecomputedPsk) {
        parameterValues.push([
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.PreSharedKey',
          computeWpaPsk(credentials.ssid5g, credentials.password),
          'xsd:string',
        ]);
      }
    }

    return parameterValues;
  }

  /** `true` solo si TODOS los parámetros rechazados son el PSK precalculado (1ra y/o 2da banda) -- cualquier otro fault (ej. SSID inválido) no debe reintentarse a ciegas. */
  private isOnlyPreSharedKeyFault(error: SetParameterValuesFaultError): boolean {
    return (
      error.faultedParameters.length > 0 &&
      error.faultedParameters.every((name) => name.endsWith('.PreSharedKey.1.PreSharedKey'))
    );
  }

  private async sendSetParameterValues(deviceId: string, parameterValues: Array<[string, string, string]>): Promise<void> {
    const taskResponse = await this.http.post(
      `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
      { name: 'setParameterValues', parameterValues },
      this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS),
    );
    await this.assertTaskSucceeded(deviceId, (taskResponse as any).data?._id);
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
    // BUG REAL corregido (2026-10-25): leía solo `setParameterValuesFault[0]`
    // -- cuando el equipo rechaza el MISMO parámetro en ambas bandas WiFi
    // (ej. "PreSharedKey.1.PreSharedKey" en WLANConfiguration.1 Y .2),
    // GenieACS reporta 2 entradas en el arreglo y la segunda se descartaba en
    // silencio. Confirmado contra el fault real de producción (deviceId
    // "987DDD-HG8546M%2DXPON-CMDCDD4D131E"): ambas entradas son necesarias
    // para que setWifiCredentials() pueda decidir si el reintento sin PSK
    // precalculado aplica (ver isOnlyPreSharedKeyFault()).
    const paramFaults: Array<{ parameterName?: string; faultString?: string }> = Array.isArray(
      fault?.detail?.setParameterValuesFault,
    )
      ? fault.detail.setParameterValuesFault
      : [];
    if (paramFaults.length === 0) {
      const reason = fault?.message || 'el equipo rechazó el cambio';
      throw new Error(`El equipo rechazó el cambio (${reason}).`);
    }
    const faultedParameters = paramFaults.map((p) => p.parameterName).filter((name): name is string => Boolean(name));
    const reason = paramFaults.map((p) => `${p.parameterName}: ${p.faultString || 'rechazado'}`).join('; ');
    throw new SetParameterValuesFaultError(faultedParameters, `El equipo rechazó el cambio (${reason}).`);
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

  /**
   * Aplica un conjunto arbitrario de parámetros TR-069 via setParameterValues.
   * Verifica el resultado real con `assertTaskSucceeded` (mismo criterio que
   * `setWifiCredentials`) -- antes de este fix (2026-10-22) esta llamada
   * nunca revisaba `/faults`, así que un rechazo real del CPE (ej. escribir
   * sobre un objeto TR-069 que todavía no existe, "Invalid parameter name")
   * quedaba reportado como éxito silencioso hacia quien llama.
   */
  async setParameterValues(deviceId: string, parameterValues: Array<[string, string, string]>): Promise<{ status: 'COMPLETED' | 'QUEUED' | 'UNKNOWN'; taskId?: string }> {
    if (this.config.wanWriteGuard) {
      return this.config.wanWriteGuard(deviceId, parameterValues.map(p => p[0]), () => this.setParameterValuesUnguarded(deviceId, parameterValues));
    }
    return this.setParameterValuesUnguarded(deviceId, parameterValues);
  }

  private async setParameterValuesUnguarded(deviceId: string, parameterValues: Array<[string, string, string]>): Promise<{ status: 'COMPLETED' | 'QUEUED' | 'UNKNOWN'; taskId?: string }> {
    try {
      const taskResponse = await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        { name: 'setParameterValues', parameterValues },
        this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS),
      );
      await this.assertTaskSucceeded(deviceId, (taskResponse as any).data?._id);
      return { status: taskResponse.status === 200 ? 'COMPLETED' : taskResponse.status === 202 ? 'QUEUED' : 'UNKNOWN', taskId: taskResponse.data?._id };
    } catch (error) {
      let message = this.describeError(error);
      for (const [path, value] of parameterValues) {
        if (/password|passphrase|presharedkey/i.test(path) && value) message = message.split(value).join('***');
      }
      throw new Error(message);
    }
  }

  /** All queued tasks block an ownership handover; never delete an unknown task. */
  async getPendingDeviceTasks(deviceId: string): Promise<unknown[]> {
    const response = await this.http.get(this.buildUrl('tasks'), {
      ...this.buildRequestConfig(), params: { query: JSON.stringify({ device: deviceId }) },
    });
    if (!Array.isArray(response.data)) throw new Error('No se pudo comprobar la cola de tareas del CPE.');
    return response.data;
  }

  /** Elimina una tarea pendiente de la cola de GenieACS (DELETE /api/v1/tasks/:taskId). */
  async deleteTask(taskId: string): Promise<void> {
    try {
      await this.http.delete(
        this.buildUrl(`tasks/${encodeURIComponent(taskId)}`),
        this.buildRequestConfig(),
      );
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Purgar/eliminar las tareas pendientes de un dispositivo en la cola de GenieACS.
   * Útil cuando se entrega el control de la WAN a la OLT (OMCI) o para destrabar
   * dispositivos con tareas encoladas que nunca se van a procesar.
   */
  async clearDeviceTasks(deviceId: string): Promise<{ deleted: number; failed: number }> {
    let tasks: unknown[] = [];
    try {
      tasks = await this.getPendingDeviceTasks(deviceId);
    } catch (error) {
      this.logger.warn(`No se pudieron consultar tareas pendientes para ${deviceId}: ${this.describeError(error)}`);
      return { deleted: 0, failed: 0 };
    }

    let deleted = 0;
    let failed = 0;
    for (const task of tasks) {
      const taskId = task && typeof task === 'object' && typeof (task as any)._id === 'string'
        ? (task as any)._id
        : null;
      if (!taskId) continue;
      try {
        await this.deleteTask(taskId);
        deleted++;
      } catch (err: any) {
        failed++;
        this.logger.warn(`No se pudo eliminar la tarea ${taskId} de GenieACS para ${deviceId}: ${err?.message}`);
      }
    }
    return { deleted, failed };
  }

  async isTaskComplete(deviceId: string, taskId: string): Promise<boolean> {
    await this.assertTaskSucceeded(deviceId, taskId);
    const response = await this.http.get(this.buildUrl('tasks'), {
      ...this.buildRequestConfig(), params: { query: JSON.stringify({ _id: taskId, device: deviceId }) },
    });
    if (!Array.isArray(response.data)) throw new Error('La cola ACS devolvió un formato desconocido.');
    return response.data.length === 0;
  }

  /**
   * Indica si una instancia de objeto TR-069 ya existe en el árbol real del
   * CPE (ej. "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1").
   * `SetParameterValues` nunca puede crear una instancia nueva -- solo
   * `AddObject` puede, así que hay que saber de antemano si ya existe antes
   * de escribirle parámetros, o el CPE rechaza todo el set con un fault TR-069
   * ("Invalid parameter name") porque el nodo no existe en su data model.
   */
  async objectInstanceExists(deviceId: string, dotPath: string): Promise<boolean> {
    try {
      const doc = await this.getDeviceDocument(deviceId);

      // TR-098: si existe un parámetro hermano "<NombreTabla>NumberOfEntries"
      // (ej. "WANPPPConnectionNumberOfEntries" junto a "WANPPPConnection"),
      // confiar en ESE contador en vez del nodo del objeto en sí -- es un
      // parámetro HOJA que el propio CPE informa en cada Inform periódico.
      // CONFIRMADO EN VIVO (2026-10-22, ONU CMDCDD4D131E): tras 3+ intentos
      // previos a este fix que escribían directo sobre "WANPPPConnection.1.*"
      // sin AddObject, GenieACS se quedó con un nodo "WANPPPConnection.1"
      // fantasma en su documento local -- declarado por esos
      // SetParameterValues fallidos, nunca confirmado por el equipo real --
      // así que chequear el nodo directamente reportaba "ya existe" aunque
      // el CPE real jamás creó esa instancia, y el AddObject real nunca
      // llegaba a ejecutarse. TR-181 no tiene este parámetro -- cae al
      // chequeo de nodo normal.
      const segments = dotPath.split('.');
      const instanceIndex = parseInt(segments[segments.length - 1], 10);
      if (Number.isFinite(instanceIndex) && segments.length >= 2) {
        const collectionName = segments[segments.length - 2];
        const countPath = [...segments.slice(0, -2), `${collectionName}NumberOfEntries`].join('.');
        const countValue = getParamValue(doc, countPath);
        if (countValue !== undefined) {
          const count = parseInt(countValue, 10);
          return Number.isFinite(count) && count >= instanceIndex;
        }
      }

      return nodeExists(doc, dotPath);
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Resuelve dinámicamente cuál es el índice real de WANConnectionDevice.{i} a utilizar
   * en TR-098 para el modo WAN solicitado (PPPOE, DHCP, STATIC).
   * Protege cualquier interfaz dedicada a gestión TR-069 (ej. VLAN 444 o ServiceList con 'TR069')
   * para no sobreescribirla ni interrumpir el canal ACS.
   */
  async resolveWanConnectionIndex(
    deviceId: string,
    wanMode: 'PPPOE' | 'DHCP' | 'STATIC',
    serviceVlan?: number,
  ): Promise<{ index: number; connectionExists: boolean; deviceExists: boolean }> {
    try {
      const doc = await this.getDeviceDocument(deviceId);
      const igd = doc?.InternetGatewayDevice;
      if (!igd) {
        return { index: 1, connectionExists: false, deviceExists: false };
      }

      const wanDevice = igd.WANDevice?.['1'] || (igd.WANDevice && typeof igd.WANDevice === 'object' ? Object.values(igd.WANDevice)[0] : null);
      const wanConnDevices = (wanDevice as any)?.WANConnectionDevice;
      if (!wanConnDevices || typeof wanConnDevices !== 'object') {
        return { index: 1, connectionExists: false, deviceExists: false };
      }

      const numericIndices: number[] = [];
      const instances: Array<{
        index: number;
        hasPpp: boolean;
        hasIp: boolean;
        isManagement: boolean;
        vlan?: number;
        serviceList?: string;
      }> = [];

      for (const [key, value] of Object.entries(wanConnDevices)) {
        const idx = parseInt(key, 10);
        if (!Number.isFinite(idx) || idx <= 0 || typeof value !== 'object' || value === null) {
          continue;
        }
        numericIndices.push(idx);

        const conn = value as any;
        const pppEntries = conn.WANPPPConnection;
        const ipEntries = conn.WANIPConnection;

        const ppp1 = pppEntries?.['1'] || (pppEntries && typeof pppEntries === 'object' ? Object.values(pppEntries)[0] : null);
        const ip1 = ipEntries?.['1'] || (ipEntries && typeof ipEntries === 'object' ? Object.values(ipEntries)[0] : null);

        const serviceList = (
          getParamValue(conn, 'WANIPConnection.1.X_HW_SERVICELIST') ||
          getParamValue(conn, 'WANPPPConnection.1.X_HW_SERVICELIST') ||
          getParamValue(conn, 'WANIPConnection.1.X_ZTE-COM_ServiceList') ||
          getParamValue(conn, 'WANPPPConnection.1.X_ZTE-COM_ServiceList') ||
          getParamValue(conn, 'WANIPConnection.1.ServiceList') ||
          getParamValue(conn, 'WANPPPConnection.1.ServiceList') ||
          ''
        ).toUpperCase();

        const rawVlan = (
          getParamValue(conn, 'WANIPConnection.1.X_HW_VLAN') ||
          getParamValue(conn, 'WANPPPConnection.1.X_HW_VLAN') ||
          getParamValue(conn, 'WANIPConnection.1.X_ZTE-COM_VLAN') ||
          getParamValue(conn, 'WANPPPConnection.1.X_ZTE-COM_VLAN') ||
          getParamValue(conn, 'WANIPConnection.1.X_BROADCOM_COM_VLANID') ||
          getParamValue(conn, 'WANPPPConnection.1.X_BROADCOM_COM_VLANID') ||
          getParamValue(conn, 'WANIPConnection.1.VLANID') ||
          getParamValue(conn, 'WANPPPConnection.1.VLANID')
        );
        const vlan = rawVlan ? parseInt(rawVlan, 10) : undefined;

        // Se considera canal de gestión si el serviceList incluye TR069 pero no INTERNET,
        // o si opera en la VLAN 444 reservada para gestión.
        const isManagement = (serviceList.includes('TR069') && !serviceList.includes('INTERNET')) ||
                             (vlan !== undefined && vlan === 444 && !serviceList.includes('INTERNET'));

        instances.push({
          index: idx,
          hasPpp: !!ppp1,
          hasIp: !!ip1,
          isManagement,
          vlan,
          serviceList,
        });
      }

      if (instances.length === 0) {
        return { index: 1, connectionExists: false, deviceExists: false };
      }

      if (wanMode === 'PPPOE') {
        const exactMatch = instances.find(inst => !inst.isManagement && inst.hasPpp && (
          (serviceVlan !== undefined && inst.vlan === serviceVlan) ||
          (inst.serviceList && inst.serviceList.includes('INTERNET'))
        ));
        if (exactMatch) {
          return { index: exactMatch.index, connectionExists: true, deviceExists: true };
        }

        const anyPpp = instances.find(inst => !inst.isManagement && inst.hasPpp);
        if (anyPpp) {
          return { index: anyPpp.index, connectionExists: true, deviceExists: true };
        }

        const emptyInstance = instances.find(inst => !inst.isManagement && !inst.hasIp && !inst.hasPpp);
        if (emptyInstance) {
          return { index: emptyInstance.index, connectionExists: false, deviceExists: true };
        }
      } else {
        const exactMatch = instances.find(inst => !inst.isManagement && inst.hasIp && (
          (serviceVlan !== undefined && inst.vlan === serviceVlan) ||
          (inst.serviceList && inst.serviceList.includes('INTERNET'))
        ));
        if (exactMatch) {
          return { index: exactMatch.index, connectionExists: true, deviceExists: true };
        }

        const anyIp = instances.find(inst => !inst.isManagement && inst.hasIp);
        if (anyIp) {
          return { index: anyIp.index, connectionExists: true, deviceExists: true };
        }

        const emptyInstance = instances.find(inst => !inst.isManagement && !inst.hasIp && !inst.hasPpp);
        if (emptyInstance) {
          return { index: emptyInstance.index, connectionExists: false, deviceExists: true };
        }
      }

      // Si todas las instancias están ocupadas por otros servicios (ej. gestión TR-069):
      const maxIndex = Math.max(...numericIndices, 0);
      return { index: maxIndex + 1, connectionExists: false, deviceExists: false };
    } catch (error) {
      this.logger.warn(`No se pudo resolver dinámicamente el índice de WANConnectionDevice para ${deviceId}: ${this.describeError(error)}. Usando índice 1 por defecto.`);
      return { index: 1, connectionExists: false, deviceExists: false };
    }
  }

  /**
   * Crea una instancia nueva dentro de una tabla de objetos TR-069 (ej.
   * "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.",
   * CON el punto final -- así lo exige CWMP AddObject). Verifica el resultado
   * real con `assertTaskSucceeded`, igual que `setParameterValues`.
   */
  async addObject(deviceId: string, objectPath: string): Promise<void> {
    if (this.config.wanWriteGuard) return this.config.wanWriteGuard(deviceId, [objectPath], () => this.addObjectUnguarded(deviceId, objectPath));
    return this.addObjectUnguarded(deviceId, objectPath);
  }

  private async addObjectUnguarded(deviceId: string, objectPath: string): Promise<void> {
    try {
      const taskResponse = await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        { name: 'addObject', objectName: objectPath },
        this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS),
      );
      await this.assertTaskSucceeded(deviceId, (taskResponse as any).data?._id);
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * Elimina una instancia dentro de una tabla de objetos TR-069 (ej.
   * "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1",
   * SIN el punto final -- a diferencia de `addObject`, DeleteObject apunta a
   * la instancia concreta a borrar, no al contenedor de la tabla). Verifica
   * el resultado real con `assertTaskSucceeded`, igual que `addObject`.
   */
  async deleteObject(deviceId: string, objectPath: string): Promise<void> {
    if (this.config.wanWriteGuard) return this.config.wanWriteGuard(deviceId, [objectPath], () => this.deleteObjectUnguarded(deviceId, objectPath));
    return this.deleteObjectUnguarded(deviceId, objectPath);
  }

  private async deleteObjectUnguarded(deviceId: string, objectPath: string): Promise<void> {
    try {
      const taskResponse = await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        { name: 'deleteObject', objectName: objectPath },
        this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS),
      );
      await this.assertTaskSucceeded(deviceId, (taskResponse as any).data?._id);
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Consulta y verifica valores de parámetros TR-069 del CPE */
  async refreshParameterValues(deviceId: string, parameterNames: string[]): Promise<Record<string, string | undefined>> {
    const response = await this.http.post(
      `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
      { name: 'getParameterValues', parameterNames }, this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS));
    if (response.status !== 200) throw new Error('La lectura del CPE quedó encolada.');
    await this.assertTaskSucceeded(deviceId, response.data?._id);
    return this.getParameterValues(deviceId, parameterNames);
  }

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

  /** Refresca un objeto o parámetro en el CPE vía refreshObject task */
  async refreshObject(deviceId: string, objectPath: string = ''): Promise<void> {
    try {
      let targetPath: string;
      if (objectPath) {
        // En el parser interno de GenieACS (Xe.parsePath), cualquier ruta que termine en punto '.'
        // provoca "Error: Invalid parameter path at refresh" al validar (s < e.length).
        // Se normaliza eliminando cualquier punto final.
        targetPath = objectPath.replace(/\.+$/, '');
      } else {
        let isTR181 = false;
        try {
          const doc = await this.getDeviceDocument(deviceId);
          isTR181 = doc?.Device !== undefined;
        } catch {
          // Por defecto la flota de ONTs es TR-098
        }
        targetPath = isTR181 ? 'Device' : 'InternetGatewayDevice';
      }

      await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        { name: 'refreshObject', objectName: targetPath },
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

  /**
   * Últimas tareas que GenieACS encoló para este CPE -- usado para el
   * "Historial de actividad TR-069" (ver GenieAcsActivityLogService; §2.3/§3.16
   * del plan: TR-069 no tiene un RPC estándar para bajar el log interno del
   * equipo, así que se usa la actividad real del lado del ACS).
   *
   * 📘 Query por el campo "device" sobre la colección `/tasks` de la NBI --
   * documentado en el esquema de GenieACS 1.2.x, pero NO confirmado en vivo
   * contra esta instancia (a diferencia de la consulta por `_id` que ya usa
   * `assertTaskSucceeded`). Validar contra la instancia real de producción
   * antes de depender de esto para una decisión operativa crítica.
   */
  async getDeviceTasks(deviceId: string, limit = 50): Promise<any[]> {
    try {
      const response = await this.http.get(this.buildUrl('tasks'), {
        ...this.buildRequestConfig(),
        params: {
          query: JSON.stringify({ device: deviceId }),
          limit,
          sort: JSON.stringify({ timestamp: -1 }),
        },
      });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /** Últimos faults (rechazos reales del CPE) registrados para este dispositivo -- misma salvedad 📘 que `getDeviceTasks`. */
  async getDeviceFaults(deviceId: string, limit = 50): Promise<any[]> {
    try {
      const response = await this.http.get(this.buildUrl('faults'), {
        ...this.buildRequestConfig(),
        params: {
          query: JSON.stringify({ device: deviceId }),
          limit,
          sort: JSON.stringify({ timestamp: -1 }),
        },
      });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      throw new Error(this.describeError(error));
    }
  }

  /**
   * RPC `Download` de TR-069 -- usado para firmware (§3.17/§2.4 del plan).
   * Sección de mayor riesgo de toda la pestaña: un firmware incorrecto puede
   * dejar el equipo inoperable. `url` debe ser alcanzable por el CPE del
   * cliente (ver GenieAcsFirmwareService, que la genera como URL prefirmada
   * de MinIO con expiración corta). Verifica el resultado real igual que
   * `addObject`/`deleteObject`.
   */
  async downloadFile(
    deviceId: string,
    params: { fileType: string; url: string; fileSize?: number; targetFileName?: string },
  ): Promise<void> {
    try {
      const taskResponse = await this.http.post(
        `${this.buildUrl(`devices/${encodeURIComponent(deviceId)}/tasks`)}?connection_request=true`,
        {
          name: 'download',
          fileType: params.fileType,
          url: params.url,
          fileSize: params.fileSize,
          targetFileName: params.targetFileName,
        },
        this.buildRequestConfig(GenieAcsClient.CONNECTION_REQUEST_TIMEOUT_MS),
      );
      await this.assertTaskSucceeded(deviceId, (taskResponse as any).data?._id);
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
 * Indica si un nodo (parámetro U OBJETO, a diferencia de getParamValue que
 * solo lee el `_value` de un parámetro hoja) existe en el árbol TR-069 del
 * dispositivo -- usado para detectar instancias de objeto (ej.
 * "WANPPPConnection.1") que todavía no fueron creadas en el CPE real.
 */
function nodeExists(doc: any, dotPath: string): boolean {
  const segments = dotPath.split('.');
  let node = doc;
  for (const segment of segments) {
    if (node === null || typeof node !== 'object' || !(segment in node)) {
      return false;
    }
    node = node[segment];
  }
  return node !== undefined;
}

/**
 * Si `value` tiene forma de dirección MAC (12 dígitos hex, con separador
 * `:`/`-`/ninguno, sin importar mayúsculas), devuelve sus 6 octetos en
 * minúscula (ej. ['b4','54','59','6f','12','04']). Si no, devuelve null —
 * así el llamador sabe que no vale la pena intentar un match por MAC (ej. un
 * serial de fábrica real tipo "HWTC..." nunca tiene esta forma).
 */
/**
 * Genera candidatos de número de serie para equipos GPON/EPON.
 * En GPON (ITU-T G.984), el serial se compone de un Vendor ID de 4 letras ASCII
 * seguido de 8 caracteres hexadecimales (ej. "HWTC7C8E7143").
 *
 * La OLT suele representarlo en formato ASCII ("HWTC7C8E7143"), pero el firmware
 * de la ONT (especialmente Huawei, ZTE, ECOM, etc.) reporta a GenieACS CWMP en
 * hexadecimal completo ("485754437C8E7143").
 *
 * Esta función genera de forma bidireccional las representaciones ASCII y Hex
 * correspondientes para asegurar que el equipo sea encontrado sin importar cómo
 * lo haya indexado GenieACS o cómo lo haya enviado el operador.
 */
export function buildSerialCandidates(serialNumber: string): string[] {
  const clean = (serialNumber || '').trim();
  const candidates = new Set<string>();
  if (!clean) return [];
  candidates.add(clean);

  // 1. De formato ASCII GPON (4 letras + 8 hex, ej. HWTC7C8E7143) a Hex completo (485754437C8E7143)
  if (/^[A-Za-z]{4}[0-9A-Fa-f]{8}$/.test(clean)) {
    const prefix = clean.slice(0, 4);
    const suffix = clean.slice(4);
    const hexPrefix = Buffer.from(prefix, 'ascii').toString('hex');
    candidates.add(`${hexPrefix}${suffix}`.toUpperCase());
    candidates.add(`${hexPrefix}${suffix}`.toLowerCase());
  }

  // 2. De formato Hex completo (16 hex, ej. 485754437C8E7143) a ASCII GPON (HWTC7C8E7143)
  if (/^[0-9A-Fa-f]{16}$/.test(clean)) {
    try {
      const asciiPrefix = Buffer.from(clean.slice(0, 8), 'hex').toString('ascii');
      if (/^[A-Za-z0-9]{4}$/.test(asciiPrefix)) {
        const asciiCandidate = `${asciiPrefix}${clean.slice(8)}`;
        candidates.add(asciiCandidate.toUpperCase());
        candidates.add(asciiCandidate.toLowerCase());
      }
    } catch {
      // Ignorar si no se puede decodificar
    }
  }

  return Array.from(candidates);
}

function parseMacOctets(value: string): string[] | null {
  const hex = (value || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12) {
    return null;
  }
  return hex.match(/.{2}/g) as string[];
}

/**
 * A partir del último octeto real de una MAC, devuelve los valores hex (2
 * dígitos cada uno) desplazados en ±1..±tolerance (excluyendo el valor
 * exacto, que ya se intentó antes de llamar a esto) — para usar en una
 * alternación regex compacta junto al prefijo fijo de los primeros 5 octetos.
 */
function buildNearbyLastOctetHexValues(lastOctetHex: string, tolerance: number): string[] {
  const lastOctetValue = parseInt(lastOctetHex, 16);
  const values: string[] = [];
  for (let delta = -tolerance; delta <= tolerance; delta++) {
    if (delta === 0) continue;
    const candidateValue = lastOctetValue + delta;
    if (candidateValue < 0 || candidateValue > 255) continue;
    values.push(candidateValue.toString(16).padStart(2, '0'));
  }
  return values;
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
