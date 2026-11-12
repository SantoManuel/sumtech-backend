import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from './entities/genieacs-audit-log.entity';
import { GenieAcsDeviceResolverService } from './genieacs-device-resolver.service';
import { GenieAcsClient, WifiCredentialsInput } from './genieacs-client';
import { GENIEACS_CLIENT } from './genieacs-client-factory';

/** 1 minuto — evita que un ciclo de reintentos o un abuso reinicie el CPE del cliente una y otra vez. */
const WIFI_CHANGE_RATE_LIMIT_MS = 60 * 1000;

/**
 * Autogestión de WiFi del cliente (Fase 02). Deliberadamente NO sabe nada de
 * autenticación de portal/contraseña de cuenta — eso es responsabilidad de
 * quien la llama (PortalService), que ya validó que el usuario es dueño del
 * contrato y reingresó su contraseña antes de llegar aquí.
 */
@Injectable()
export class GenieAcsWifiService {
  private readonly logger = new Logger(GenieAcsWifiService.name);

  constructor(
    @InjectRepository(GenieAcsDeviceEntity)
    private readonly deviceRepository: Repository<GenieAcsDeviceEntity>,
    @InjectRepository(GenieAcsAuditLogEntity)
    private readonly auditRepository: Repository<GenieAcsAuditLogEntity>,
    private readonly resolver: GenieAcsDeviceResolverService,
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
  ) {}

  /** Estado actual (cacheado) del WiFi de un contrato — no golpea la NBI si ya está resuelto. */
  async getWifiStatus(contractId: string): Promise<{ linked: boolean; ssid?: string; ssid5g?: string; lastSyncError?: string | null }> {
    const device = await this.resolver.resolveForContract(contractId);
    if (!device || !device.genieacsDeviceId) {
      return { linked: false, lastSyncError: device?.lastSyncError };
    }
    return { linked: true, ssid: device.ssid ?? undefined, ssid5g: device.ssid5g ?? undefined, lastSyncError: device.lastSyncError };
  }

  async changeWifiForDevice(
    genieacsDeviceId: string,
    credentials: WifiCredentialsInput,
    actor: 'CLIENTE' | 'STAFF' = 'STAFF',
    contractId?: string,
    existingDevice?: GenieAcsDeviceEntity | null,
  ): Promise<{ ssid: string; ssid5g?: string }> {
    if (!this.client) {
      throw new ServiceUnavailableException('El servicio de gestión de red no está disponible en este momento.');
    }

    let device = existingDevice;
    if (device === undefined) {
      if (contractId && this.deviceRepository.findOneBy) {
        device = await this.deviceRepository.findOneBy({ contractId });
      } else if (this.deviceRepository.findOneBy) {
        device = await this.deviceRepository.findOneBy({ genieacsDeviceId });
      }
    }

    if (device?.lastWifiChangeAt) {
      const elapsedMs = Date.now() - device.lastWifiChangeAt.getTime();
      if (elapsedMs < WIFI_CHANGE_RATE_LIMIT_MS) {
        const waitMinutes = Math.ceil((WIFI_CHANGE_RATE_LIMIT_MS - elapsedMs) / 60000);
        throw new ConflictException(
          `Ya cambiaste tu WiFi hace poco. Esperá ${waitMinutes} minuto(s) antes de volver a intentarlo.`,
        );
      }
    }

    const oldSsid = device?.ssid ?? undefined;

    try {
      const status = await this.client.getDeviceStatus(genieacsDeviceId);
      await this.client.setWifiCredentials(genieacsDeviceId, status.isTR181, credentials);

      if (device) {
        device.ssid = credentials.ssid;
        device.ssid5g = credentials.ssid5g ?? device.ssid5g;
        device.lastWifiChangeAt = new Date();
        device.lastSyncError = null;
        await this.deviceRepository.save(device);
      }

      await this.recordAudit(contractId || device?.contractId || 'UNKNOWN', genieacsDeviceId, 'OK', undefined, oldSsid, credentials.ssid, actor);
      return { ssid: credentials.ssid, ssid5g: credentials.ssid5g };
    } catch (error) {
      const message = (error as Error).message;
      if (device) {
        device.lastSyncError = message;
        await this.deviceRepository.save(device);
      }
      await this.recordAudit(contractId || device?.contractId || 'UNKNOWN', genieacsDeviceId, 'ERROR', message, oldSsid, credentials.ssid, actor);
      this.logger.error(`Error cambiando el WiFi del dispositivo ${genieacsDeviceId}: ${message}`);
      throw new BadGatewayException(`No se pudo aplicar el cambio de WiFi: ${message}`);
    }
  }

  async changeWifiCredentials(
    contractId: string,
    credentials: WifiCredentialsInput,
    actor: 'CLIENTE' | 'STAFF' = 'CLIENTE',
  ): Promise<GenieAcsDeviceEntity> {
    const device = await this.resolver.resolveForContract(contractId);
    if (!device || !device.genieacsDeviceId) {
      throw new NotFoundException(
        'Tu equipo todavía no está vinculado a la red — contacta a soporte para que verifiquen la instalación.',
      );
    }

    await this.changeWifiForDevice(device.genieacsDeviceId, credentials, actor, contractId, device);
    return device;
  }

  private async recordAudit(
    contractId: string,
    genieacsDeviceId: string,
    result: 'OK' | 'ERROR',
    errorMessage: string | undefined,
    oldSsid: string | undefined,
    newSsid: string,
    actor: 'CLIENTE' | 'STAFF',
  ): Promise<void> {
    await this.auditRepository.save(
      this.auditRepository.create({
        contractId,
        genieacsDeviceId,
        action: 'WIFI_CHANGE',
        actor,
        result,
        errorMessage,
        oldSsid,
        newSsid,
      }),
    );
  }
}
