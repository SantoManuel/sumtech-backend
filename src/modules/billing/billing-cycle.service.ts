import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { InvoiceGeneratedEvent } from './events/invoice-generated.event';
import { TenantIteratorService } from '../../common/tenancy/tenant-iterator.service';
import { BillingSettingsEntity } from './entities/billing-settings.entity';
import {
  daysBetween,
  daysInMonth,
  resolveBillingDayForMonth,
  resolveProrationDayCount,
  toDateString,
} from './billing-date.util';

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
    private readonly tenantIterator: TenantIteratorService,
  ) {}

  // Este cron corre en background, sin request/tenant asociado — a diferencia
  // de runBillingCycle() cuando se invoca desde POST /billing/run-cycle (ahí
  // el tenant ya está resuelto por TenantResolutionMiddleware). Por eso el
  // punto de entrada del @Cron itera cada tenant ACTIVE, uno a la vez, y
  // corre el mismo runBillingCycle() sin cambios dentro del contexto de cada
  // uno — la lógica de negocio no se toca.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDailyBillingCycle(): Promise<void> {
    const referenceDate = new Date();
    await this.tenantIterator.runForEachActiveTenant('billing-cycle', async (tenant) => {
      this.logger.log(`Ciclo de facturación recurrente — tenant '${tenant.slug}'`);
      await this.runBillingCycle(referenceDate);
    });
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
    const targetDay = resolveBillingDayForMonth(year, month, contract.billingDay);

    if (referenceDate.getDate() !== targetDay) {
      return false;
    }

    const periodStartStr = toDateString(year, month, 1);
    const periodEndStr = toDateString(year, month, daysInMonth(year, month));
    const dueDateStr = toDateString(year, month, targetDay);

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

  /**
   * Genera la primera factura de un contrato recién activado, prorrateada si la
   * activación (`contract.startDate`) no coincide con el inicio del mes
   * calendario que le corresponde facturar (sección 9 del spec de facturación).
   * Se invoca una sola vez, al crear el contrato (`ClientsService.addContract`)
   * — nunca desde el cron: `generateInvoiceForContractIfDue` ya no vuelve a
   * generar una factura para este mismo período gracias al índice único
   * `(contractId, billingPeriodStart)`, así que no hay caso especial que
   * mantener ahí. Devuelve `null` si ya existe una factura para ese período
   * (idempotente) o si `contract.plan` no viene cargado.
   */
  async generateInitialProratedInvoiceIfNeeded(
    contract: ContractEntity,
    settings: BillingSettingsEntity,
  ): Promise<InvoiceEntity | null> {
    const plan = contract.plan;
    if (!plan) {
      throw new Error('generateInitialProratedInvoiceIfNeeded requiere contract.plan cargado');
    }

    const [startYear, startMonth] = contract.startDate.split('-').map(Number);
    const year = startYear;
    const month = startMonth - 1; // 0-indexado, igual que Date.getMonth()

    const periodStartStr = toDateString(year, month, 1);
    const periodEndStr = toDateString(year, month, daysInMonth(year, month));

    const cycleDays = resolveProrationDayCount(settings.prorationDayCountPolicy, periodStartStr, periodEndStr);
    const rawDaysUsed = daysBetween(periodEndStr, contract.startDate) + 1;
    // Nunca se cobra más que un mes completo por la política de días elegida
    // (ej. FIXED_30 en un mes de 31 días activado el día 1: 31 días de uso,
    // pero el tope es el propio cycleDays -> precio completo, no 31/30 de más).
    const effectiveDaysUsed = Math.min(rawDaysUsed, cycleDays);
    const isProrated = effectiveDaysUsed < cycleDays;

    const monthlyPrice = Number(plan.monthlyPrice);
    const subtotal = Number(((monthlyPrice / cycleDays) * effectiveDaysUsed).toFixed(2));
    const itbisTotal = Number((subtotal * Number(plan.itbisRate)).toFixed(2));
    const cdtAmount = Number((subtotal * Number(plan.cdtRate)).toFixed(2));
    const grandTotal = Number((subtotal + itbisTotal + cdtAmount).toFixed(2));
    const periodLabel = new Date(year, month, 1).toLocaleDateString('es-DO', {
      month: 'long',
      year: 'numeric',
    });
    const concept = isProrated
      ? `${plan.name} - Servicio prorrateado de ${periodLabel} (${effectiveDaysUsed} de ${cycleDays} días)`
      : `${plan.name} - Servicio de ${periodLabel}`;

    try {
      const invoice = this.invoiceRepository.create({
        clientId: contract.clientId,
        contractId: contract.id,
        status: 'PENDING_PAYMENT',
        subtotal,
        itbisTotal,
        cdtAmount,
        grandTotal,
        dueDate: contract.startDate,
        billingPeriodStart: periodStartStr,
        billingPeriodEnd: periodEndStr,
        concept,
        isProrated,
        proratedDays: effectiveDaysUsed,
        prorationDayCountPolicy: settings.prorationDayCountPolicy,
        cycleDays,
      });
      const saved = await this.invoiceRepository.save(invoice);

      const event: InvoiceGeneratedEvent = {
        invoiceId: saved.id,
        clientId: contract.clientId,
        contractId: contract.id,
        concept,
        grandTotal,
        dueDate: contract.startDate,
        occurredOn: new Date(),
      };
      this.eventEmitter.emit(SystemEvents.INVOICE_GENERATED, event);

      return saved;
    } catch (error) {
      // Mismo manejo de condición de carrera que generateInvoiceForContractIfDue.
      if (error?.code === '23505') {
        this.logger.warn(
          `Factura inicial ya existente para el contrato ${contract.contractNumber} y período ${periodStartStr}; se omite.`,
        );
        return null;
      }
      throw error;
    }
  }
}
