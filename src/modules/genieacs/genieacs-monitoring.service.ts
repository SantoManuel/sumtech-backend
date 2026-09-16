import { BadGatewayException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from './entities/genieacs-audit-log.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { GenieAcsDeviceResolverService } from './genieacs-device-resolver.service';
import { GenieAcsClient } from './genieacs-client';
import { GENIEACS_CLIENT } from './genieacs-client-factory';
import { computeOnlineStatus, isOpticalPowerCritical, OnuOnlineStatus } from './genieacs-online-status.util';

export interface OnuLiveStatus {
  linked: boolean;
  onlineStatus?: OnuOnlineStatus;
  ssid?: string;
  ssid5g?: string;
  opticalRxPowerDbm?: number;
  alertLowOpticalPower?: boolean;
  lastInformAt?: Date;
  lastRebootAt?: Date | null;
  lastSyncError?: string | null;
}

/**
 * Panel de soporte del ERP (Fase 03): estado en vivo y reinicio remoto de la
 * ONU de un contrato. A diferencia de GenieAcsWifiService (autogestión del
 * cliente), esto es de uso exclusivo de staff (ADMIN/GERENTE) — sin
 * reautenticación con contraseña, pero sí con auditoría de quién lo hizo.
 */
@Injectable()
export class GenieAcsMonitoringService {
  private readonly logger = new Logger(GenieAcsMonitoringService.name);

  constructor(
    @InjectRepository(GenieAcsDeviceEntity)
    private readonly deviceRepository: Repository<GenieAcsDeviceEntity>,
    @InjectRepository(GenieAcsAuditLogEntity)
    private readonly auditRepository: Repository<GenieAcsAuditLogEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    private readonly resolver: GenieAcsDeviceResolverService,
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
  ) {}

  /** Estado en vivo (consulta la NBI en el momento, no solo el caché) de la ONU de un contrato. */
  async getLiveStatus(contractId: string): Promise<OnuLiveStatus> {
    await this.assertContractExists(contractId);

    const device = await this.resolver.resolveForContract(contractId);
    if (!device || !device.genieacsDeviceId) {
      return { linked: false, lastSyncError: device?.lastSyncError };
    }

    if (!this.client) {
      return {
        linked: true,
        onlineStatus: 'UNKNOWN',
        lastRebootAt: device.lastRebootAt,
        lastSyncError: 'El servicio de gestión de red no está disponible en este momento.',
      };
    }

    try {
      const status = await this.client.getDeviceStatus(device.genieacsDeviceId);
      const onlineStatus = computeOnlineStatus(status.lastInformAt);

      device.ssid = status.ssid ?? device.ssid;
      device.ssid5g = status.ssid5g ?? device.ssid5g;
      device.opticalRxPowerDbm = status.opticalRxPowerDbm ?? null;
      device.lastInformAt = status.lastInformAt ?? null;
      device.onlineStatus = onlineStatus;
      device.lastSyncAt = new Date();
      device.lastSyncError = null;
      await this.deviceRepository.save(device);

      return {
        linked: true,
        onlineStatus,
        ssid: status.ssid,
        ssid5g: status.ssid5g,
        opticalRxPowerDbm: status.opticalRxPowerDbm,
        alertLowOpticalPower: isOpticalPowerCritical(status.opticalRxPowerDbm),
        lastInformAt: status.lastInformAt,
        lastRebootAt: device.lastRebootAt,
      };
    } catch (error) {
      const message = (error as Error).message;
      device.lastSyncError = message;
      await this.deviceRepository.save(device);
      this.logger.error(`Error consultando el estado en vivo del contrato ${contractId}: ${message}`);
      return { linked: true, onlineStatus: 'UNKNOWN', lastRebootAt: device.lastRebootAt, lastSyncError: message };
    }
  }

  /** Reinicio remoto — el cliente pierde internet ~60s. Solo staff (ver Roles en el controlador). */
  async rebootDevice(contractId: string, actor: string): Promise<void> {
    await this.assertContractExists(contractId);

    const device = await this.resolver.resolveForContract(contractId);
    if (!device || !device.genieacsDeviceId) {
      throw new NotFoundException('Este contrato todavía no tiene un equipo vinculado a la red.');
    }
    if (!this.client) {
      throw new ServiceUnavailableException('El servicio de gestión de red no está disponible en este momento.');
    }

    try {
      await this.client.rebootDevice(device.genieacsDeviceId);
      device.lastRebootAt = new Date();
      device.lastSyncError = null;
      await this.deviceRepository.save(device);
      await this.recordAudit(contractId, device.genieacsDeviceId, actor, 'OK');
    } catch (error) {
      const message = (error as Error).message;
      device.lastSyncError = message;
      await this.deviceRepository.save(device);
      await this.recordAudit(contractId, device.genieacsDeviceId, actor, 'ERROR', message);
      throw new BadGatewayException(`No se pudo reiniciar el equipo: ${message}`);
    }
  }

  private async assertContractExists(contractId: string): Promise<void> {
    const exists = await this.contractRepository.findOneBy({ id: contractId });
    if (!exists) {
      throw new NotFoundException(`Contrato ${contractId} no encontrado.`);
    }
  }

  private async recordAudit(
    contractId: string,
    genieacsDeviceId: string,
    actor: string,
    result: 'OK' | 'ERROR',
    errorMessage?: string,
  ): Promise<void> {
    await this.auditRepository.save(
      this.auditRepository.create({
        contractId,
        genieacsDeviceId,
        action: 'REBOOT',
        actor,
        result,
        errorMessage,
      }),
    );
  }
}
