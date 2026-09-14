import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { BillingSettingsService } from './billing-settings.service';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { PaymentReminderEvent } from './events/payment-reminder.event';
import { ContractSuspendedEvent } from './events/contract-suspended.event';
import { ContractReactivatedEvent } from './events/contract-reactivated.event';

export interface MorosidadCycleResult {
  advanceRemindersSent: number;
  overdueRemindersSent: number;
  contractsSuspended: number;
  failed: number;
}

export interface CarteraVencidaReport {
  summary: {
    totalOverdueInvoices: number;
    totalOverdueAmount: number;
    clientsAffected: number;
  };
  items: Array<{
    invoiceId: string;
    clientId: string;
    clientName?: string;
    docNumber?: string;
    contractNumber?: string;
    planName?: string;
    contractStatus?: string;
    dueDate?: string;
    daysOverdue: number;
    grandTotal: number;
  }>;
}

/**
 * Motor de morosidad: envía recordatorios preventivos/de vencimiento y suspende
 * administrativamente contratos con facturas vencidas más allá del período de
 * gracia configurado. La suspensión es solo un cambio de estado en el ERP — el
 * corte real de red (GenieACS/RADIUS) queda fuera de alcance de este módulo.
 */
@Injectable()
export class MorosidadService {
  private readonly logger = new Logger(MorosidadService.name);

  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepository: Repository<InvoiceEntity>,
    private readonly billingSettingsService: BillingSettingsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDailyMorosidadCycle(): Promise<void> {
    await this.runMorosidadCycle(new Date());
  }

  async runMorosidadCycle(referenceDate: Date): Promise<MorosidadCycleResult> {
    const settings = await this.billingSettingsService.getSettings();
    const todayStr = this.toDateString(referenceDate);

    const invoices = await this.invoiceRepository.find({
      where: { status: 'PENDING_PAYMENT' },
      relations: ['contract'],
    });

    const result: MorosidadCycleResult = {
      advanceRemindersSent: 0,
      overdueRemindersSent: 0,
      contractsSuspended: 0,
      failed: 0,
    };

    const contractsToSuspend = new Map<string, { contract: ContractEntity; daysOverdue: number }>();

    for (const invoice of invoices) {
      try {
        if (!invoice.dueDate) {
          continue;
        }
        const daysUntilDue = this.daysBetween(invoice.dueDate, todayStr);

        if (
          !invoice.advanceReminderSentAt &&
          daysUntilDue >= 0 &&
          daysUntilDue <= settings.advanceReminderDaysBeforeDue
        ) {
          await this.sendReminder(invoice, 'ADVANCE');
          result.advanceRemindersSent++;
        }

        if (daysUntilDue < 0) {
          const daysOverdue = -daysUntilDue;

          if (!invoice.overdueReminderSentAt && daysOverdue >= settings.reminderDaysAfterDue) {
            await this.sendReminder(invoice, 'OVERDUE', daysOverdue);
            result.overdueRemindersSent++;
          }

          if (
            daysOverdue >= settings.graceDaysBeforeSuspension &&
            invoice.contractId &&
            invoice.contract?.status === 'ACTIVE'
          ) {
            const existingEntry = contractsToSuspend.get(invoice.contractId);
            if (!existingEntry || daysOverdue > existingEntry.daysOverdue) {
              contractsToSuspend.set(invoice.contractId, { contract: invoice.contract, daysOverdue });
            }
          }
        }
      } catch (error) {
        result.failed++;
        this.logger.error(
          `Error procesando la factura ${invoice.id} en el ciclo de morosidad: ${error.message}`,
          error.stack,
        );
      }
    }

    for (const { contract, daysOverdue } of contractsToSuspend.values()) {
      try {
        await this.suspendContract(contract, daysOverdue);
        result.contractsSuspended++;
      } catch (error) {
        result.failed++;
        this.logger.error(
          `Error suspendiendo el contrato ${contract.contractNumber}: ${error.message}`,
          error.stack,
        );
      }
    }

    this.logger.log(
      `Ciclo de morosidad completado: ${result.advanceRemindersSent} recordatorio(s) preventivo(s), ` +
        `${result.overdueRemindersSent} recordatorio(s) de vencimiento, ${result.contractsSuspended} contrato(s) suspendido(s), ` +
        `${result.failed} fallo(s).`,
    );
    return result;
  }

  /**
   * Reactiva un contrato SUSPENDED si ya no tiene facturas PENDING_PAYMENT
   * vencidas. Pensado para ser invocado tras liquidarse un cobro (Fase 4).
   */
  async reactivateIfSettled(contractId: string): Promise<boolean> {
    const contract = await this.contractRepository.findOneBy({ id: contractId });
    if (!contract || contract.status !== 'SUSPENDED') {
      return false;
    }

    const todayStr = this.toDateString(new Date());
    const overdueCount = await this.invoiceRepository.count({
      where: { contractId, status: 'PENDING_PAYMENT', dueDate: LessThan(todayStr) },
    });

    if (overdueCount > 0) {
      return false;
    }

    contract.status = 'ACTIVE';
    await this.contractRepository.save(contract);

    const event: ContractReactivatedEvent = {
      contractId: contract.id,
      clientId: contract.clientId,
      contractNumber: contract.contractNumber,
      occurredOn: new Date(),
    };
    this.eventEmitter.emit(SystemEvents.CONTRACT_REACTIVATED, event);

    return true;
  }

  async getCarteraVencida(referenceDate: Date = new Date()): Promise<CarteraVencidaReport> {
    const todayStr = this.toDateString(referenceDate);
    const overdueInvoices = await this.invoiceRepository.find({
      where: { status: 'PENDING_PAYMENT', dueDate: LessThan(todayStr) },
      relations: ['contract', 'contract.plan', 'client'],
      order: { dueDate: 'ASC' },
    });

    const items = overdueInvoices.map((invoice) => ({
      invoiceId: invoice.id,
      clientId: invoice.clientId,
      clientName: invoice.client?.name,
      docNumber: invoice.client?.docNumber,
      contractNumber: invoice.contract?.contractNumber,
      planName: invoice.contract?.plan?.name,
      contractStatus: invoice.contract?.status,
      dueDate: invoice.dueDate,
      daysOverdue: invoice.dueDate ? -this.daysBetween(invoice.dueDate, todayStr) : 0,
      grandTotal: Number(invoice.grandTotal || 0),
    }));

    const totalOverdueAmount = items.reduce((sum, item) => sum + item.grandTotal, 0);
    const clientsAffected = new Set(items.map((item) => item.clientId)).size;

    return {
      summary: {
        totalOverdueInvoices: items.length,
        totalOverdueAmount,
        clientsAffected,
      },
      items,
    };
  }

  private async sendReminder(
    invoice: InvoiceEntity,
    kind: 'ADVANCE' | 'OVERDUE',
    daysOverdue?: number,
  ): Promise<void> {
    const event: PaymentReminderEvent = {
      invoiceId: invoice.id,
      clientId: invoice.clientId,
      contractId: invoice.contractId,
      concept: invoice.concept || 'Servicio Sumtech',
      grandTotal: Number(invoice.grandTotal || 0),
      dueDate: invoice.dueDate!,
      kind,
      daysOverdue,
      occurredOn: new Date(),
    };
    this.eventEmitter.emit(SystemEvents.PAYMENT_REMINDER_DUE, event);

    if (kind === 'ADVANCE') {
      invoice.advanceReminderSentAt = new Date();
    } else {
      invoice.overdueReminderSentAt = new Date();
    }
    await this.invoiceRepository.save(invoice);
  }

  private async suspendContract(contract: ContractEntity, daysOverdue: number): Promise<void> {
    contract.status = 'SUSPENDED';
    await this.contractRepository.save(contract);

    const event: ContractSuspendedEvent = {
      contractId: contract.id,
      clientId: contract.clientId,
      contractNumber: contract.contractNumber,
      daysOverdue,
      occurredOn: new Date(),
    };
    this.eventEmitter.emit(SystemEvents.CONTRACT_SUSPENDED, event);
  }

  /** Diferencia en días (dueDate - today); negativa si dueDate ya pasó. */
  private daysBetween(dueDateStr: string, todayStr: string): number {
    const due = this.parseDateOnly(dueDateStr);
    const today = this.parseDateOnly(todayStr);
    return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  private parseDateOnly(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  private toDateString(date: Date): string {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${mm}-${dd}`;
  }
}
