import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GENIEACS_WEBHOOK_QUEUE, GENIEACS_WEBHOOK_JOBS, GENIEACS_EVENTS } from '../genieacs-webhook.constants';
import { GenieAcsEventPayload } from '../controllers/genieacs-webhook.controller';
import { GenieAcsDeviceEntity } from '../entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from '../entities/genieacs-audit-log.entity';
import { SerialNumberEntity } from '../../inventory/entities/serial-number.entity';
import { TenantIteratorService } from '../../../common/tenancy/tenant-iterator.service';

@Processor(GENIEACS_WEBHOOK_QUEUE)
export class GenieAcsWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(GenieAcsWebhookProcessor.name);

  constructor(
    @InjectRepository(GenieAcsDeviceEntity)
    private readonly deviceRepository: Repository<GenieAcsDeviceEntity>,
    @InjectRepository(GenieAcsAuditLogEntity)
    private readonly auditRepository: Repository<GenieAcsAuditLogEntity>,
    @InjectRepository(SerialNumberEntity)
    private readonly serialRepository: Repository<SerialNumberEntity>,
    private readonly tenantIterator: TenantIteratorService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<GenieAcsEventPayload>): Promise<any> {
    if (job.name === GENIEACS_WEBHOOK_JOBS.DEVICE_EVENT) {
      return this.handleDeviceEvent(job.data);
    }
    this.logger.warn(`[GenieAcsWebhookProcessor] Tipo de job no reconocido: ${job.name}`);
  }

  private async handleDeviceEvent(payload: GenieAcsEventPayload): Promise<any> {
    this.logger.log(
      `[GenieAcsWebhookProcessor] Procesando evento '${payload.eventType}' para dispositivo ${payload.deviceId}`,
    );

    let foundTenant: string | null = null;
    let targetContractId: string | null = null;

    // Iteramos por cada tenant activo hasta encontrar el CPE correspondiente
    await this.tenantIterator.runForEachActiveTenant('genieacs-webhook-processor', async (tenant) => {
      if (foundTenant) {
        return; // Ya fue localizado y procesado en un tenant anterior
      }

      const decodedId = decodeURIComponent(payload.deviceId);
      let device = await this.deviceRepository.findOne({
        where: [{ genieacsDeviceId: payload.deviceId }, { genieacsDeviceId: decodedId }],
      });

      // Si no coincide directo por ID de GenieACS, intentamos resolver por candidatos de número de serie
      if (!device) {
        const serialCandidates = this.extractSerialCandidates(payload.deviceId);
        for (const candidate of serialCandidates) {
          const serialRecord = await this.serialRepository.findOne({
            where: { serialNumber: candidate },
          });

          if (serialRecord?.currentContractId) {
            device = await this.deviceRepository.findOne({
              where: { contractId: serialRecord.currentContractId },
            });

            if (device) {
              device.genieacsDeviceId = payload.deviceId;
              device.serialNumberId = serialRecord.id;
              break;
            }
          }
        }
      }

      if (device) {
        foundTenant = tenant.slug;
        targetContractId = device.contractId;
        await this.applyEventToDevice(device, payload, tenant.slug);
      }
    });

    if (!foundTenant) {
      this.logger.warn(
        `[GenieAcsWebhookProcessor] Dispositivo ${payload.deviceId} huérfano (no vinculado a ningún contrato en ningún tenant). Evento: ${payload.eventType}`,
      );
      return {
        processed: true,
        orphan: true,
        deviceId: payload.deviceId,
        eventType: payload.eventType,
      };
    }

    return {
      processed: true,
      tenant: foundTenant,
      deviceId: payload.deviceId,
      contractId: targetContractId || undefined,
      eventType: payload.eventType,
    };
  }

  private async applyEventToDevice(
    device: GenieAcsDeviceEntity,
    payload: GenieAcsEventPayload,
    tenantSlug: string,
  ): Promise<void> {
    const eventType = (payload.eventType || '').toUpperCase();
    const details = payload.details || '';

    switch (eventType) {
      case 'BOOTSTRAP':
      case 'BOOTSTRAP_COMPLETE': {
        device.lastSyncAt = new Date();
        device.onlineStatus = 'ONLINE';
        device.lastSyncError = null;
        await this.deviceRepository.save(device);

        await this.auditRepository.save({
          contractId: device.contractId,
          genieacsDeviceId: device.genieacsDeviceId || payload.deviceId,
          action: 'TR069_PARAMETER_CHANGE',
          actor: 'GENIEACS',
          result: 'OK',
          parameterPath: 'Device',
          newValue: `BOOTSTRAP_COMPLETE: ${details || 'Dispositivo registrado en GenieACS'}`,
        });

        this.eventEmitter.emit(GENIEACS_EVENTS.BOOTSTRAP_COMPLETE, {
          tenant: tenantSlug,
          contractId: device.contractId,
          deviceId: payload.deviceId,
          payload,
        });
        break;
      }

      case 'PLAN_APPLIED': {
        device.lastSyncAt = new Date();
        device.lastSyncError = null;
        await this.deviceRepository.save(device);

        await this.auditRepository.save({
          contractId: device.contractId,
          genieacsDeviceId: device.genieacsDeviceId || payload.deviceId,
          action: 'TR069_PARAMETER_CHANGE',
          actor: 'GENIEACS',
          result: 'OK',
          parameterPath: 'PlanConfig',
          newValue: details || 'PLAN_APPLIED',
        });

        this.eventEmitter.emit(GENIEACS_EVENTS.PLAN_APPLIED, {
          tenant: tenantSlug,
          contractId: device.contractId,
          deviceId: payload.deviceId,
          payload,
        });
        break;
      }

      case 'OPTICAL_ALARM': {
        device.lastSyncAt = new Date();
        // Intentar parsear el valor numérico en dBm si viene en el texto de detalles o metadata
        const rxMatch = details.match(/(-?\d+(?:\.\d+)?)\s*dBm/i);
        if (rxMatch) {
          device.opticalRxPowerDbm = parseFloat(rxMatch[1]);
        } else if (payload.metadata?.rxPower !== undefined) {
          device.opticalRxPowerDbm = parseFloat(payload.metadata.rxPower);
        }
        await this.deviceRepository.save(device);

        await this.auditRepository.save({
          contractId: device.contractId,
          genieacsDeviceId: device.genieacsDeviceId || payload.deviceId,
          action: 'DIAGNOSTIC_RUN',
          actor: 'GENIEACS',
          result: 'OK',
          parameterPath: 'OpticalRxPower',
          newValue: details || 'OPTICAL_ALARM',
        });

        this.eventEmitter.emit(GENIEACS_EVENTS.OPTICAL_ALARM, {
          tenant: tenantSlug,
          contractId: device.contractId,
          deviceId: payload.deviceId,
          rxPower: device.opticalRxPowerDbm,
          payload,
        });
        break;
      }

      case 'FIRMWARE_UPDATE_TRIGGERED': {
        await this.auditRepository.save({
          contractId: device.contractId,
          genieacsDeviceId: device.genieacsDeviceId || payload.deviceId,
          action: 'FIRMWARE_PUSH',
          actor: 'GENIEACS',
          result: 'OK',
          parameterPath: 'Firmware',
          newValue: details || 'FIRMWARE_UPDATE_TRIGGERED',
        });

        this.eventEmitter.emit(GENIEACS_EVENTS.FIRMWARE_TRIGGERED, {
          tenant: tenantSlug,
          contractId: device.contractId,
          deviceId: payload.deviceId,
          payload,
        });
        break;
      }

      default: {
        device.lastSyncAt = new Date();
        await this.deviceRepository.save(device);

        this.eventEmitter.emit('genieacs.device.event', {
          tenant: tenantSlug,
          contractId: device.contractId,
          deviceId: payload.deviceId,
          payload,
        });
        break;
      }
    }
  }

  private extractSerialCandidates(deviceId: string): string[] {
    const candidates = new Set<string>();
    candidates.add(deviceId);
    const decoded = decodeURIComponent(deviceId);
    candidates.add(decoded);

    const parts = decoded.split('-');
    if (parts.length > 1) {
      const lastPart = parts[parts.length - 1];
      candidates.add(lastPart);

      // Si empieza en 48575443 (HWTC en ASCII hex), agregar versión ASCII
      if (lastPart.toUpperCase().startsWith('48575443')) {
        const asciiSerial = 'HWTC' + lastPart.substring(8);
        candidates.add(asciiSerial);
      }
    }

    return Array.from(candidates);
  }
}

