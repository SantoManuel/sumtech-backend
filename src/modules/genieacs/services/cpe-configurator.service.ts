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

    // 5. Asignar tag multitenant TENANT:<slug> si fue especificado
    if (input.tenantSlug) {
      const tenantTag = `TENANT:${input.tenantSlug.toLowerCase().trim()}`;
      try {
        await client.setDeviceTag(deviceId, tenantTag);
      } catch (err: any) {
        this.logger.warn(`[CPE-CONFIG] No se pudo asignar tag ${tenantTag} a ${deviceId}: ${err.message}`);
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
