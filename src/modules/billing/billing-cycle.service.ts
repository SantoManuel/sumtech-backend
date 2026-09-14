import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { InvoiceGeneratedEvent } from './events/invoice-generated.event';

export interface BillingCycleResult {
  generated: number;
  skipped: number;
  failed: number;
}

/**
 * Motor de facturación recurrente (MRR): evalúa diariamente los contratos ACTIVE
 * y genera, para el día de corte de cada uno, una factura PENDING_PAYMENT sin
 * NCF asignado. El e-CF solo se timbra al momento del cobro (ver Fase 4,
 * InvoicingService.settleInvoice) para preservar el correlativo secuencial DGII.
 */
@Injectable()
export class BillingCycleService {
  private readonly logger = new Logger(BillingCycleService.name);

  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepository: Repository<InvoiceEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDailyBillingCycle(): Promise<void> {
    await this.runBillingCycle(new Date());
  }

  /**
   * Ejecuta el ciclo de facturación para la fecha indicada. Cada contrato se
   * procesa en su propio try/catch: un fallo aislado no aborta el lote completo.
   */
  async runBillingCycle(referenceDate: Date): Promise<BillingCycleResult> {
    const activeContracts = await this.contractRepository.find({
      where: { status: 'ACTIVE' },
      relations: ['plan'],
    });

    const result: BillingCycleResult = { generated: 0, skipped: 0, failed: 0 };

    for (const contract of activeContracts) {
      try {
        const wasGenerated = await this.generateInvoiceForContractIfDue(contract, referenceDate);
        if (wasGenerated) {
          result.generated++;
        } else {
          result.skipped++;
        }
      } catch (error) {
        result.failed++;
        this.logger.error(
          `Error generando factura recurrente para el contrato ${contract.contractNumber}: ${error.message}`,
          error.stack,
        );
      }
    }

    this.logger.log(
      `Ciclo de facturación recurrente completado: ${result.generated} generada(s), ${result.skipped} omitida(s), ${result.failed} fallida(s).`,
    );
    return result;
  }

  /**
   * Genera la factura del período vigente para el contrato si (a) hoy corresponde
   * a su día de corte (con clamping para meses cortos) y (b) aún no existe una
   * factura para ese (contrato, período). Devuelve true si se generó una factura.
   */
  private async generateInvoiceForContractIfDue(
    contract: ContractEntity,
    referenceDate: Date,
  ): Promise<boolean> {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    const targetDay = this.resolveBillingDayForMonth(year, month, contract.billingDay);

    if (referenceDate.getDate() !== targetDay) {
      return false;
    }

    const periodStartStr = this.toDateString(year, month, 1);
    const periodEndStr = this.toDateString(year, month, this.daysInMonth(year, month));
    const dueDateStr = this.toDateString(year, month, targetDay);

    const existing = await this.invoiceRepository.findOne({
      where: { contractId: contract.id, billingPeriodStart: periodStartStr },
    });
    if (existing && existing.status !== 'VOIDED') {
      return false;
    }

    const plan = contract.plan;
    const subtotal = Number(plan.monthlyPrice);
    const itbisTotal = Number((subtotal * Number(plan.itbisRate)).toFixed(2));
    const cdtAmount = Number((subtotal * Number(plan.cdtRate)).toFixed(2));
    const grandTotal = Number((subtotal + itbisTotal + cdtAmount).toFixed(2));
    const periodLabel = new Date(year, month, 1).toLocaleDateString('es-DO', {
      month: 'long',
      year: 'numeric',
    });
    const concept = `${plan.name} - Servicio de ${periodLabel}`;

    try {
      const invoice = this.invoiceRepository.create({
        clientId: contract.clientId,
        contractId: contract.id,
        status: 'PENDING_PAYMENT',
        subtotal,
        itbisTotal,
        cdtAmount,
        grandTotal,
        dueDate: dueDateStr,
        billingPeriodStart: periodStartStr,
        billingPeriodEnd: periodEndStr,
        concept,
      });
      const saved = await this.invoiceRepository.save(invoice);

      const event: InvoiceGeneratedEvent = {
        invoiceId: saved.id,
        clientId: contract.clientId,
        contractId: contract.id,
        concept,
        grandTotal,
        dueDate: dueDateStr,
        occurredOn: new Date(),
      };
      this.eventEmitter.emit(SystemEvents.INVOICE_GENERATED, event);

      return true;
    } catch (error) {
      // Protección de última línea ante condiciones de carrera: el índice único
      // parcial uq_invoices_contract_period (migración 020) puede rechazar un
      // insert concurrente para el mismo (contrato, período); se trata como
      // "ya generada", no como un fallo real.
      if (error?.code === '23505') {
        this.logger.warn(
          `Factura ya existente para el contrato ${contract.contractNumber} y período ${periodStartStr}; se omite.`,
        );
        return false;
      }
      throw error;
    }
  }

  private resolveBillingDayForMonth(year: number, month: number, billingDay: number): number {
    return Math.min(billingDay, this.daysInMonth(year, month));
  }

  private daysInMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
  }

  private toDateString(year: number, month: number, day: number): string {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }
}
