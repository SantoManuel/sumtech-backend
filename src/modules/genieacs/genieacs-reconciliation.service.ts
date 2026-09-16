import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { TicketsService } from '../tickets/tickets.service';
import { CreateTicketDto } from '../tickets/dto/ticket.dto';
import { GenieAcsClient } from './genieacs-client';
import { GENIEACS_CLIENT } from './genieacs-client-factory';
import { computeOnlineStatus, isOpticalPowerCritical, ONU_OPTICAL_ALERT_THRESHOLD_DBM } from './genieacs-online-status.util';

/** Título exacto usado para detectar si ya existe una alerta abierta y no duplicarla — nunca cambiar sin migrar los tickets ya creados con este título. */
const OPTICAL_ALERT_TICKET_TITLE = '[Alerta GenieACS] Potencia óptica degradada';

export interface ReconciliationResult {
  checked: number;
  updated: number;
  alertsCreated: number;
  failed: number;
}

/**
 * Fase 04: mantiene al día el estado online/offline y la potencia óptica de
 * cada ONU vinculada, sin depender de que alguien abra la pantalla del
 * cliente para refrescarlo (ver GenieAcsMonitoringService, que sí refresca
 * bajo demanda). Corre cada 10 minutos — margen suficiente frente al Inform
 * periódico de 5 min de GenieACS sin generar carga innecesaria sobre la NBI.
 */
@Injectable()
export class GenieAcsReconciliationService {
  private readonly logger = new Logger(GenieAcsReconciliationService.name);

  constructor(
    @InjectRepository(GenieAcsDeviceEntity)
    private readonly deviceRepository: Repository<GenieAcsDeviceEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    private readonly ticketsService: TicketsService,
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleReconciliation(): Promise<void> {
    await this.reconcileAll();
  }

  async reconcileAll(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = { checked: 0, updated: 0, alertsCreated: 0, failed: 0 };

    if (!this.client) {
      this.logger.warn('GenieACS no está configurado (GENIEACS_NBI_BASE_URL/GENIEACS_NBI_API_KEY) — se omite la reconciliación.');
      return result;
    }

    const devices = await this.deviceRepository.find({ where: { genieacsDeviceId: Not(IsNull()) } });
    result.checked = devices.length;

    for (const device of devices) {
      try {
        const status = await this.client.getDeviceStatus(device.genieacsDeviceId!);
        const wasCritical = isOpticalPowerCritical(device.opticalRxPowerDbm);
        const isCritical = isOpticalPowerCritical(status.opticalRxPowerDbm);

        device.ssid = status.ssid ?? device.ssid;
        device.ssid5g = status.ssid5g ?? device.ssid5g;
        device.opticalRxPowerDbm = status.opticalRxPowerDbm ?? null;
        device.lastInformAt = status.lastInformAt ?? null;
        device.onlineStatus = computeOnlineStatus(status.lastInformAt);
        device.lastSyncAt = new Date();
        device.lastSyncError = null;
        await this.deviceRepository.save(device);
        result.updated++;

        // Solo se crea alerta en la TRANSICIÓN a crítico, no en cada ciclo mientras siga crítico
        // (evita un ticket nuevo cada 10 min mientras dure la degradación).
        if (isCritical && !wasCritical) {
          const created = await this.createOpticalAlertTicketIfNeeded(device, status.opticalRxPowerDbm!);
          if (created) {
            result.alertsCreated++;
          }
        }
      } catch (error) {
        result.failed++;
        const message = (error as Error).message;
        this.logger.error(`Error reconciliando el contrato ${device.contractId}: ${message}`);
        try {
          device.lastSyncError = message;
          await this.deviceRepository.save(device);
        } catch {
          // Si ni siquiera se puede guardar el error, se continúa con el resto — no debe abortar el ciclo completo.
        }
      }
    }

    this.logger.log(
      `Reconciliación GenieACS: ${result.checked} equipo(s) revisado(s), ${result.updated} actualizado(s), ` +
        `${result.alertsCreated} alerta(s) de potencia óptica creada(s), ${result.failed} fallo(s).`,
    );
    return result;
  }

  /** Devuelve true si se creó un ticket nuevo; false si ya había uno abierto (no se duplica) o si el contrato no existe. */
  private async createOpticalAlertTicketIfNeeded(device: GenieAcsDeviceEntity, opticalRxPowerDbm: number): Promise<boolean> {
    const existingOpenAlert = await this.ticketRepository.findOne({
      where: {
        contractId: device.contractId,
        title: OPTICAL_ALERT_TICKET_TITLE,
        status: In(['OPEN', 'IN_PROGRESS', 'ON_HOLD']),
      },
    });
    if (existingOpenAlert) {
      return false;
    }

    const contract = await this.contractRepository.findOneBy({ id: device.contractId });
    if (!contract) {
      this.logger.warn(`No se pudo crear el ticket de alerta óptica: el contrato ${device.contractId} ya no existe.`);
      return false;
    }

    const dto: CreateTicketDto = {
      clientId: contract.clientId,
      contractId: contract.id,
      type: 'REPAIR_FAULT',
      priority: 'HIGH',
      title: OPTICAL_ALERT_TICKET_TITLE,
      description:
        `Potencia óptica de recepción degradada a ${opticalRxPowerDbm.toFixed(2)} dBm ` +
        `(umbral de alerta: ${ONU_OPTICAL_ALERT_THRESHOLD_DBM} dBm). ` +
        'Generado automáticamente por el monitoreo periódico de GenieACS — verificar el enlace de fibra en campo.',
    };

    await this.ticketsService.create(dto);
    return true;
  }
}
