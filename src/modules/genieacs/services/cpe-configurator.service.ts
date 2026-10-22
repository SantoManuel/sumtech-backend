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

export interface CpeConfigureResult {
  success: boolean;
  deviceId: string;
  appliedParametersCount: number;
  verification: Record<string, string | undefined>;
  message: string;
}

@Injectable()
export class CpeConfiguratorService {
  private readonly logger = new Logger(CpeConfiguratorService.name);

  constructor(
    @Optional()
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
    private readonly parameterMapper: CpeParameterMapper,
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
    const client = this.getClient();

    // 1. Localizar dispositivo en GenieACS por serial
    const deviceId = await client.findDeviceBySerial(input.serialNumber);
    if (!deviceId) {
      throw new NotFoundException(
        `El CPE con serial "${input.serialNumber}" no ha sido detectado por GenieACS (aún no ha enviado Inform).`,
      );
    }

    // 2. Obtener estado y determinar modelo de datos (TR-181 vs TR-098)
    const deviceStatus = await client.getDeviceStatus(deviceId);
    const isTR181 = deviceStatus.isTR181;

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
    const wanObject = this.getWanObjectPaths(input, isTR181);
    if (wanObject) {
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

    // 3. Generar parámetros con el mapper técnico
    const parameterValues = this.parameterMapper.buildParameterValues(input, isTR181);

    if (parameterValues.length === 0) {
      return {
        success: true,
        deviceId,
        appliedParametersCount: 0,
        verification: {},
        message: 'No hay parámetros de configuración para aplicar en el CPE.',
      };
    }

    this.logger.log(
      `[CPE-CONFIG] Aplicando ${parameterValues.length} parámetros TR-069 al CPE ${input.serialNumber} (ID: ${deviceId}, TR-181: ${isTR181}).`,
    );

    // 4. Enviar setParameterValues vía NBI con connection_request=true
    try {
      await client.setParameterValues(deviceId, parameterValues);
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

    // 6. Verificar lectura de parámetros clave
    const verificationKeys = this.parameterMapper.getVerificationParameters(input, isTR181);
    let verification: Record<string, string | undefined> = {};
    if (verificationKeys.length > 0) {
      try {
        verification = await client.getParameterValues(deviceId, verificationKeys);
      } catch (err: any) {
        this.logger.warn(`[CPE-CONFIG] No se pudo verificar parámetros de vuelta para ${deviceId}: ${err.message}`);
      }
    }

    return {
      success: true,
      deviceId,
      appliedParametersCount: parameterValues.length,
      verification,
      message: `Configuración TR-069 aplicada y encolada con éxito al CPE ${input.serialNumber}.`,
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
  ): { instancePath: string; parentPath: string } | null {
    if (!input.wanMode) {
      return null;
    }
    if (isTR181) {
      if (input.wanMode === 'PPPOE') {
        return { instancePath: 'Device.PPP.Interface.1', parentPath: 'Device.PPP.Interface.' };
      }
      return { instancePath: 'Device.IP.Interface.1', parentPath: 'Device.IP.Interface.' };
    }
    if (input.wanMode === 'PPPOE') {
      return {
        instancePath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1',
        parentPath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.',
      };
    }
    return {
      instancePath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1',
      parentPath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.',
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
