import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Inject,
  Optional,
} from '@nestjs/common';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient } from '../genieacs-client';
import { CpeParameterMapper, CpeConfigurationInput } from './cpe-parameter-mapper';
import { CpeWanPolicyService } from './cpe-wan-policy.service';

export interface CpeConfigureResult {
  applicationStatus?: 'APPLIED' | 'QUEUED' | 'VERIFYING';
  taskId?: string;
  expectedReadback?: Record<string, string>;
  success: boolean;
  deviceId: string;
  appliedParametersCount: number;
  verification: Record<string, string | undefined>;
  /** Asignación real de IPv6 obtenida tras la negociación (Fase 3.1). */
  ipv6Readback?: { prefix?: string; address?: string };
  message: string;
  /** Aviso no fatal -- ej. "Dual-Stack pedido pero no implementado para este modo" (ver CpeParameterMapper.getIpv6Warning). */
  warning?: string;
}

@Injectable()
export class CpeConfiguratorService {
  private readonly logger = new Logger(CpeConfiguratorService.name);

  constructor(
    @Optional()
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
    private readonly parameterMapper: CpeParameterMapper,
    @Optional() private readonly wanPolicy?: CpeWanPolicyService,
  ) {}

  private getClient(): GenieAcsClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El servidor GenieACS no está configurado (falta GENIEACS_NBI_BASE_URL o GENIEACS_NBI_API_KEY).',
      );
    }
    return this.client;
  }

  /**
   * Empuja la configuración técnica hacia el CPE mediante GenieACS NBI y verifica su aplicación.
   * RF-OLT-013, RF-ONU-001, RF-ONU-004.
   */
  async configureCpe(input: CpeConfigurationInput): Promise<CpeConfigureResult> {
    if (input.wanMode && this.wanPolicy) {
      return this.wanPolicy.withSerial(input.serialNumber, () => this.configureCpeUnlocked(input));
    }
    return this.configureCpeUnlocked(input);
  }

  private async configureCpeUnlocked(input: CpeConfigurationInput): Promise<CpeConfigureResult> {
    const client = this.getClient();

    // 1. Localizar dispositivo en GenieACS por serial
    const deviceId = await client.findDeviceBySerial(input.serialNumber, input.wanMode ? { exactOnly: true } : undefined);
    if (!deviceId) {
      throw new NotFoundException(
        `El CPE con serial "${input.serialNumber}" no ha sido detectado por GenieACS (aún no ha enviado Inform).`,
      );
    }

    // 2. Obtener estado y determinar modelo de datos (TR-181 vs TR-098)
    if (input.wanMode) this.wanPolicy?.bindResolvedDevice(deviceId);
    const deviceStatus = await client.getDeviceStatus(deviceId);
    const isTR181 = deviceStatus.isTR181;

    // Fallback de fabricante si fue registrado como genérico o nulo (Fallo #2)
    if (!input.vendor || input.vendor.toUpperCase() === 'ALL' || input.vendor.toUpperCase() === 'GENERIC') {
      if (deviceStatus.manufacturer) {
        input.vendor = deviceStatus.manufacturer;
      }
    }

    // Resolver dinámicamente el índice de WANConnectionDevice en TR-098 (Fallo #1)
    let wanConnectionIndex = input.wanConnectionIndex ?? 1;
    if (!isTR181 && input.wanMode) {
      const resolved = await client.resolveWanConnectionIndex(deviceId, input.wanMode, input.serviceVlan);
      wanConnectionIndex = resolved.index;
      input.wanConnectionIndex = wanConnectionIndex;
    }

    // 2.5. Asegurar que la instancia de objeto WAN exista ANTES de escribirle
    // parámetros -- "SetParameterValues" nunca puede crear una instancia
    // nueva (solo "AddObject" puede). `objectInstanceExists` ya resuelve el
    // chequeo leyendo el documento real de GenieACS (node + "NumberOfEntries"
    // si aplica, ver esa nota) -- esta rama solo se activa cuando el objeto
    // GENUINAMENTE no existe todavía.
    //
    // NO se usa `refreshObject()` acá -- CONFIRMADO EN VIVO (2026-10-22)
    // contra la ONU CMDCDD4D131E: la función interna "refresh" de GenieACS
    // rechaza con "script.Error: Invalid parameter path" cualquier ruta
    // terminada en punto (notación recursiva) contra este dispositivo, sin
    // importar el nivel de profundidad -- confirmado probando 4 variantes de
    // ruta distintas, todas fallaron igual. `refreshObject()` nunca revisa
    // `/faults` (ver GenieAcsClient.refreshObject), así que esta falla era
    // silenciosa y el refresh nunca hacía nada útil -- solo ensuciaba el log
    // de faults del dispositivo en GenieACS, generando ruido confuso para
    // cualquiera que revise esa pestaña después. Se quita por completo.
    const wanObject = this.getWanObjectPaths(input, isTR181, wanConnectionIndex);
    if (wanObject) {
      // Si el WANConnectionDevice contenedor no existe aún (ej. instancia 2 o nueva), intentar crearlo primero
      if (wanObject.devicePath && wanObject.deviceParentPath) {
        const devExists = await client.objectInstanceExists(deviceId, wanObject.devicePath);
        if (!devExists) {
          this.logger.log(
            `[CPE-CONFIG] "${wanObject.devicePath}" no existe en ${deviceId} -- creándolo con AddObject.`,
          );
          try {
            await client.addObject(deviceId, wanObject.deviceParentPath);
          } catch (err: any) {
            this.logger.warn(`[CPE-CONFIG] No se pudo crear ${wanObject.devicePath} con AddObject: ${err.message}. Continuando.`);
          }
        }
      }

      const exists = await client.objectInstanceExists(deviceId, wanObject.instancePath);
      if (!exists) {
        this.logger.log(
          `[CPE-CONFIG] "${wanObject.instancePath}" no existe todavía en ${deviceId} -- creándolo con AddObject antes de configurar la WAN.`,
        );
        try {
          await client.addObject(deviceId, wanObject.parentPath);
        } catch (err: any) {
          throw new BadRequestException(
            `No se pudo crear el objeto WAN "${wanObject.parentPath}" en el CPE: ${err.message}`,
          );
        }
        const createdNow = await client.objectInstanceExists(deviceId, wanObject.instancePath);
        if (!createdNow) {
          throw new BadRequestException(
            `El CPE no creó la instancia esperada "${wanObject.instancePath}" tras AddObject -- puede haber numerado la conexión con otro índice. Revisar manualmente el dispositivo en GenieACS.`,
          );
        }
      }
    }

    // 3. Generar parámetros con el mapper técnico usando el wanConnectionIndex resuelto
    const parameterValues = this.parameterMapper.buildParameterValues(input, isTR181, wanConnectionIndex);
    const ipv6Warning = this.parameterMapper.getIpv6Warning(input, isTR181);

    if (parameterValues.length === 0) {
      return {
        success: true,
        deviceId,
        appliedParametersCount: 0,
        verification: {},
        message: 'No hay parámetros de configuración para aplicar en el CPE.',
        warning: ipv6Warning,
      };
    }

    this.logger.log(
      `[CPE-CONFIG] Aplicando ${parameterValues.length} parámetros TR-069 al CPE ${input.serialNumber} (ID: ${deviceId}, TR-181: ${isTR181}).`,
    );

    // 4. Enviar setParameterValues vía NBI con connection_request=true
    let delivery: { status: 'COMPLETED' | 'QUEUED' | 'UNKNOWN'; taskId?: string } | void;
    try {
      delivery = await client.setParameterValues(deviceId, parameterValues);
    } catch (err: any) {
      this.logger.error(`[CPE-CONFIG] Error en setParameterValues para ${deviceId}: ${err.message}`);
      throw new BadRequestException(`Fallo enviando configuración TR-069 al CPE: ${err.message}`);
    }

    // 5. Asignar tags multitenant/OLT si fueron especificados -- GenieACS es
    // una sola instancia compartida por todos los tenants/OLTs, así que esto
    // es lo único que identifica a quién pertenece un CPE ahí. Idempotente:
    // reusa los tags ya leídos en el paso 2 (deviceStatus) para no llamar
    // setDeviceTag si ya están puestos -- importante porque este método se
    // reintenta automáticamente (ver OnuCpeSyncReconciliationService).
    const existingTags = deviceStatus.tags || [];
    const desiredTags: string[] = [];
    if (input.tenantSlug) {
      desiredTags.push(`TENANT:${input.tenantSlug.toLowerCase().trim()}`);
    }
    if (input.oltName) {
      desiredTags.push(`OLT:${input.oltName}`);
    }
    for (const tag of desiredTags) {
      if (existingTags.includes(tag)) {
        continue;
      }
      try {
        await client.setDeviceTag(deviceId, tag);
      } catch (err: any) {
        this.logger.warn(`[CPE-CONFIG] No se pudo asignar tag ${tag} a ${deviceId}: ${err.message}`);
      }
    }

    // 5.b Habilitar acceso HTTP por WAN a la GUI web del CPE (RF-OLT Ficha 360
    // "Interfaz Web de la ONU") -- de fábrica el ACL del equipo bloquea HTTP
    // desde el lado WAN/gestión, así que el proxy del ERP nunca puede
    // alcanzarlo aunque el equipo esté online (confirmado en vivo 2026-11-10,
    // ONU HWTC7BDC60D9: timeout consistente en el puerto 80 hasta activar
    // este parámetro, 200 OK inmediato después). Solo Huawei por ahora --
    // el ACL de ZTE es una tabla de reglas (X_ZTE-COM_Security.AclServices),
    // no un flag simple, y no se encontró todavía la combinación correcta de
    // campos que de verdad abra el puerto (un intento real no lo logró).
    // Best-effort: nunca debe hacer fallar el resto de la configuración.
    const isHuawei = (input.vendor || '').toUpperCase().includes('HUAWEI') || (input.serialNumber || '').toUpperCase().startsWith('HWTC');
    if (isHuawei) {
      try {
        await client.setParameterValues(deviceId, [
          ['InternetGatewayDevice.X_HW_Security.AclServices.HTTPWanEnable', 'true', 'xsd:boolean'],
        ]);
      } catch (err: any) {
        this.logger.warn(`[CPE-CONFIG] No se pudo habilitar acceso HTTP WAN en ${deviceId}: ${err.message}`);
      }
    }

    // 6. Verificar lectura de parámetros clave
    const readableExpected = parameterValues.filter(([key]) => !/password|passphrase|presharedkey/i.test(key));
    const verificationKeys = [...new Set([
      ...this.parameterMapper.getVerificationParameters(input, isTR181, wanConnectionIndex),
      ...readableExpected.map(([key]) => key),
    ])];
    let verification: Record<string, string | undefined> = {};
    if (verificationKeys.length > 0) {
      try {
        verification = await client.refreshParameterValues(deviceId, verificationKeys);
      } catch (err: any) {
        this.logger.warn(`[CPE-CONFIG] No se pudo verificar parámetros de vuelta para ${deviceId}: ${err.message}`);
      }
    }

    const ipv6Readback = this.parameterMapper.extractIpv6Readback(verification, isTR181, wanConnectionIndex);
    const expected = parameterValues.filter(([key]) => !/password|passphrase|presharedkey/i.test(key));
    const confirmed = delivery?.status === 'COMPLETED' && expected.length > 0 &&
      expected.every(([key, value]) => String(verification[key]) === String(value));

    return {
      success: true,
      applicationStatus: confirmed ? 'APPLIED' : delivery?.status === 'QUEUED' ? 'QUEUED' : 'VERIFYING',
      taskId: delivery?.taskId,
      expectedReadback: Object.fromEntries(expected.map(([key, value]) => [key, value])),
      deviceId,
      appliedParametersCount: parameterValues.length,
      verification,
      ipv6Readback,
      message: confirmed ? 'Configuración TR-069 confirmada.' : 'Configuración enviada; falta confirmar su aplicación.',
      warning: ipv6Warning,
    };
  }

  /**
   * Resuelve a qué tabla de objetos TR-069 pertenece el modo WAN pedido, y
   * cuál sería la ruta de su primera instancia -- usado por `configureCpe()`
   * para saber si hace falta `AddObject` antes de escribir parámetros.
   * `null` si el modo no requiere ningún objeto nuevo (ej. sin `wanMode`).
   */
  private getWanObjectPaths(
    input: CpeConfigurationInput,
    isTR181: boolean,
    wanConnectionIndex: number = 1,
  ): { instancePath: string; parentPath: string; devicePath?: string; deviceParentPath?: string } | null {
    if (!input.wanMode) {
      return null;
    }
    if (isTR181) {
      if (input.wanMode === 'PPPOE') {
        return { instancePath: 'Device.PPP.Interface.1', parentPath: 'Device.PPP.Interface' };
      }
      return { instancePath: 'Device.IP.Interface.1', parentPath: 'Device.IP.Interface' };
    }
    const devPath = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${wanConnectionIndex}`;
    if (input.wanMode === 'PPPOE') {
      return {
        instancePath: `${devPath}.WANPPPConnection.1`,
        parentPath: `${devPath}.WANPPPConnection`,
        devicePath: devPath,
        deviceParentPath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice',
      };
    }
    return {
      instancePath: `${devPath}.WANIPConnection.1`,
      parentPath: `${devPath}.WANIPConnection`,
      devicePath: devPath,
      deviceParentPath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice',
    };
  }

  /**
   * Resuelve un identificador de CPE (serial/MAC del ONU, o ya el _id real de
   * GenieACS) al _id real de GenieACS. Lanza NotFoundException si el CPE
   * nunca reportó al ACS — mismo criterio que configureCpe(), que ya
   * trataba esto como error esperado y no como 500. refreshCpe/factoryResetCpe
   * antes NO validaban esto: si no se encontraba el device, seguían de
   * largo usando el serial/MAC crudo como si fuera un _id de GenieACS, y
   * GenieACS respondía 404 a esa consulta → describeError() lo envolvía en
   * un Error genérico → el filtro global de excepciones lo convertía en 500
   * "Internal Server Error" sin mensaje útil, en vez de comunicar con
   * claridad que el ONU EPON/HiOSO todavía no hizo su primer Inform TR-069.
   */
  private async resolveDeviceId(client: GenieAcsClient, serialOrDeviceId: string): Promise<string> {
    if (serialOrDeviceId.includes('-')) {
      return serialOrDeviceId;
    }
    const resolved = await client.findDeviceBySerial(serialOrDeviceId);
    if (!resolved) {
      throw new NotFoundException(
        `El CPE con serial/MAC "${serialOrDeviceId}" no ha sido detectado por GenieACS (aún no ha enviado su primer Inform TR-069).`,
      );
    }
    return resolved;
  }

  /**
   * Refresca los parámetros de un CPE forzando lectura vía connection_request.
   */
  async refreshCpe(serialOrDeviceId: string): Promise<{ success: boolean; deviceId: string }> {
    const client = this.getClient();
    const deviceId = await this.resolveDeviceId(client, serialOrDeviceId);
    await client.refreshObject(deviceId);
    return { success: true, deviceId };
  }

  /**
   * Ejecuta un FactoryReset TR-069 en el CPE.
   */
  async factoryResetCpe(serialOrDeviceId: string): Promise<{ success: boolean; deviceId: string }> {
    const client = this.getClient();
    const deviceId = await this.resolveDeviceId(client, serialOrDeviceId);
    await client.factoryReset(deviceId);
    return { success: true, deviceId };
  }
}
