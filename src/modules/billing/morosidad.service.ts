import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { BillingSettingsService } from './billing-settings.service';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { PaymentReminderEvent } from './events/payment-reminder.event';
import { ContractSuspendedEvent } from './events/contract-suspended.event';
import { ContractReactivatedEvent } from './events/contract-reactivated.event';
import { TenantIteratorService } from '../../common/tenancy/tenant-iterator.service';
import { OPEN_INVOICE_STATUSES } from '../invoicing/invoice-status.util';
import { addDays, daysBetween } from './billing-date.util';
import { SuspensionHistoryService } from './suspension-history.service';
import { ServiceControlService } from '../network/service-control.service';
import { NetworkProvisioningPortRegistry } from '../network/network-provisioning-port.registry';
import { NetworkAccessEntity } from '../network/entities/network-access.entity';

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

export interface GetDelinquentsQueryDto {
  search?: string;
  nodeId?: string;
  medium?: 'PPPOE' | 'OLT_NATIVE' | 'NONE';
  minDaysOverdue?: number;
  status?: string;
}

export interface DelinquentItem {
  clientId: string;
  clientName: string;
  docNumber?: string;
  phone?: string;
  contractId: string;
  contractNumber: string;
  contractStatus: string;
  billingDay: number;
  planName?: string;
  graceDaysOverride?: number | null;
  effectiveGraceDays: number;
  daysOverdue: number;
  scheduledSuspensionDate: string;
  overdueInvoicesCount: number;
  totalOverdueAmount: number;
  overdueInvoices: Array<{
    id: string;
    ncfNumber?: string;
    dueDate: string;
    daysOverdue: number;
    grandTotal: number;
    status: string;
  }>;
  suspensionMedium: 'PPPOE' | 'OLT_NATIVE' | 'NONE';
  networkStatus: {
    nodeId?: string;
    nodeName?: string;
    nodeStatus?: string;
    onuId?: string;
    onuSerial?: string;
    pendingOperation?: string | null;
    isDeviceOnline: boolean;
  };
}

export interface DelinquentsReport {
  summary: {
    totalDelinquentContracts: number;
    totalOverdueAmount: number;
    suspendedInEquipment: number;
    pendingInQueue: number;
    withoutEquipment: number;
  };
  items: DelinquentItem[];
}

/**
 * ARCHIVO: src/modules/billing/morosidad.service.ts
 * CAPA: Servicio de Dominio (Fase 7 - RF-BILL-001, RF-BILL-002, RF-BILL-003, RF-PPPOE-007)
 * RESPONSABILIDAD:
 * - Ciclo diario de morosidad con cálculo de gracia configurable por contrato (graceDaysOverride ?? settings).
 * - Suspensión confirmada en hardware vía ServiceControlService (CRON_MOROSIDAD).
 * - Si el router/OLT está offline, el contrato permanece ACTIVE con pendingOperation='SUSPEND' encola en BullMQ.
 * - Lista operativa de morosos (GET /billing/delinquents) con estado de red y fecha prevista de corte.
 * - Reactivación automática tras liquidar facturas (reactivateIfSettled).
 */
@Injectable()
export class MorosidadService {
  private readonly logger = new Logger(MorosidadService.name);

  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepository: Repository<InvoiceEntity>,
    @InjectRepository(NetworkAccessEntity)
    private readonly accessRepository: Repository<NetworkAccessEntity>,
    private readonly billingSettingsService: BillingSettingsService,
    private readonly suspensionHistoryService: SuspensionHistoryService,
    private readonly serviceControlService: ServiceControlService,
    private readonly portRegistry: NetworkProvisioningPortRegistry,
    private readonly eventEmitter: EventEmitter2,
    private readonly tenantIterator: TenantIteratorService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDailyMorosidadCycle(): Promise<void> {
    const referenceDate = new Date();
    await this.tenantIterator.runForEachActiveTenant('morosidad-cycle', async (tenant) => {
      this.logger.log(`Ciclo de morosidad — tenant '${tenant.slug}'`);
      await this.runMorosidadCycle(referenceDate);
    });
  }

  async runMorosidadCycle(referenceDate: Date): Promise<MorosidadCycleResult> {
    const settings = await this.billingSettingsService.getSettings();
    const todayStr = this.toDateString(referenceDate);

    const invoices = await this.invoiceRepository.find({
      where: { status: In(OPEN_INVOICE_STATUSES) },
      relations: ['contract'],
    });

    const result: MorosidadCycleResult = {
      advanceRemindersSent: 0,
      overdueRemindersSent: 0,
      contractsSuspended: 0,
      failed: 0,
    };

    const contractsToSuspend = new Map<string, { contract: ContractEntity; daysOverdue: number; invoiceId: string }>();

    for (const invoice of invoices) {
      try {
        if (!invoice.dueDate) {
          continue;
        }
        const daysUntilDue = daysBetween(invoice.dueDate, todayStr);
        let reminderSentThisRun = false;

        if (
          !invoice.advanceReminderSentAt &&
          daysUntilDue >= 0 &&
          daysUntilDue <= settings.advanceReminderDaysBeforeDue
        ) {
          await this.sendReminder(invoice, 'ADVANCE');
          reminderSentThisRun = true;
          result.advanceRemindersSent++;
        }

        if (daysUntilDue < 0) {
          const daysOverdue = -daysUntilDue;
          let stateChanged = false;

          if (invoice.daysOverdue !== daysOverdue) {
            invoice.daysOverdue = daysOverdue;
            stateChanged = true;
          }

          const effectiveGraceDays = invoice.contract?.graceDaysOverride ?? settings.graceDaysBeforeSuspension;
          const targetStatus: InvoiceEntity['status'] =
            daysOverdue >= effectiveGraceDays ? 'VENCIDA' : 'EN_GRACIA';

          if (invoice.status !== targetStatus) {
            if (!invoice.gracePeriodStartedAt) {
              invoice.gracePeriodStartedAt = addDays(invoice.dueDate, 1);
              invoice.gracePeriodEndsAt = addDays(invoice.dueDate, effectiveGraceDays);
            }
            invoice.status = targetStatus;
            stateChanged = true;
          }

          if (!invoice.overdueReminderSentAt && daysOverdue >= settings.reminderDaysAfterDue) {
            await this.sendReminder(invoice, 'OVERDUE', daysOverdue);
            reminderSentThisRun = true;
            result.overdueRemindersSent++;
          } else if (stateChanged && !reminderSentThisRun) {
            await this.invoiceRepository.save(invoice);
          }

          if (
            daysOverdue >= effectiveGraceDays &&
            invoice.contractId &&
            invoice.contract?.status === 'ACTIVE'
          ) {
            const existingEntry = contractsToSuspend.get(invoice.contractId);
            if (!existingEntry || daysOverdue > existingEntry.daysOverdue) {
              contractsToSuspend.set(invoice.contractId, { contract: invoice.contract, daysOverdue, invoiceId: invoice.id });
            }
          }
        }
      } catch (error: any) {
        result.failed++;
        this.logger.error(
          `Error procesando la factura ${invoice.id} en el ciclo de morosidad: ${error.message}`,
          error.stack,
        );
      }
    }

    for (const { contract, daysOverdue, invoiceId } of contractsToSuspend.values()) {
      try {
        await this.suspendContract(contract, daysOverdue, invoiceId);
        result.contractsSuspended++;
      } catch (error: any) {
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
   * Reactiva un contrato si ya no tiene facturas vencidas abiertas (RF-BILL-003 / PPPOE-007).
   * Invocado tras liquidarse un cobro o al recibirse el evento SystemEvents.INVOICE_PAID.
   */
  async reactivateIfSettled(contractId: string, reconnectionFeeInvoiceId?: string): Promise<boolean> {
    const contract = await this.contractRepository.findOneBy({ id: contractId });
    if (!contract || contract.status !== 'SUSPENDED') {
      return false;
    }

    const todayStr = this.toDateString(new Date());
    const overdueCount = await this.invoiceRepository.count({
      where: { contractId, status: In(OPEN_INVOICE_STATUSES), dueDate: LessThan(todayStr) },
    });

    if (overdueCount > 0) {
      return false;
    }

    // Ejecutamos la restauración en hardware a través de ServiceControlService con proceso 'PAGO'
    try {
      await this.serviceControlService.restoreService(contractId, {
        process: 'PAGO',
        reason: 'Reactivación automática tras liquidar facturas vencidas',
      });
    } catch (controlError: any) {
      this.logger.warn(`Error en control de servicio al reactivar contrato ${contractId}: ${controlError.message}`);
    }

    if (contract.status === 'SUSPENDED') {
      contract.status = 'ACTIVE';
      await this.contractRepository.save(contract);

      await this.suspensionHistoryService.closeSuspension(contractId, { reconnectionFeeInvoiceId });

      const event: ContractReactivatedEvent = {
        contractId: contract.id,
        clientId: contract.clientId,
        contractNumber: contract.contractNumber,
        reason: 'Reactivación automática: facturas vencidas liquidadas.',
        occurredOn: new Date(),
      };
      this.eventEmitter.emit(SystemEvents.CONTRACT_REACTIVATED, event);
    }

    return true;
  }

  /**
   * Obtiene la lista operativa de contratos morosos con facturas vencidas y estado de red (RF-BILL-001).
   */
  async getDelinquents(query?: GetDelinquentsQueryDto, referenceDate: Date = new Date()): Promise<DelinquentsReport> {
    const settings = await this.billingSettingsService.getSettings();
    const todayStr = this.toDateString(referenceDate);

    // Buscamos todas las facturas abiertas vencidas
    const overdueInvoices = await this.invoiceRepository.find({
      where: { status: In(OPEN_INVOICE_STATUSES), dueDate: LessThan(todayStr) },
      relations: ['contract', 'contract.plan', 'client'],
      order: { dueDate: 'ASC' },
    });

    // Mapeamos los contratos únicos
    const contractMap = new Map<string, {
      contract: ContractEntity;
      client: any;
      invoices: InvoiceEntity[];
    }>();

    for (const inv of overdueInvoices) {
      if (!inv.contractId || !inv.contract) continue;
      const entry = contractMap.get(inv.contractId);
      if (entry) {
        entry.invoices.push(inv);
      } else {
        contractMap.set(inv.contractId, {
          contract: inv.contract,
          client: inv.client,
          invoices: [inv],
        });
      }
    }

    // Buscamos los accesos de red correspondientes
    const contractIds = Array.from(contractMap.keys());
    const accesses = contractIds.length > 0
      ? await this.accessRepository.find({
          where: { contractId: In(contractIds) },
          relations: ['node', 'onu', 'onu.olt'],
        })
      : [];

    const accessMap = new Map<string, NetworkAccessEntity>();
    for (const acc of accesses) {
      if (acc.contractId) accessMap.set(acc.contractId, acc);
    }

    const items: DelinquentItem[] = [];

    for (const [contractId, { contract, client, invoices }] of contractMap.entries()) {
      const access = accessMap.get(contractId);
      const effectiveGraceDays = contract.graceDaysOverride ?? settings.graceDaysBeforeSuspension;

      // Calcular máximo días de atraso
      let maxDaysOverdue = 0;
      let earliestDueDate = invoices[0]?.dueDate || todayStr;

      const formattedInvoices = invoices.map((inv) => {
        const dOverdue = inv.dueDate ? Math.max(0, -daysBetween(inv.dueDate, todayStr)) : 0;
        if (dOverdue > maxDaysOverdue) {
          maxDaysOverdue = dOverdue;
          earliestDueDate = inv.dueDate || earliestDueDate;
        }
        return {
          id: inv.id,
          ncfNumber: inv.ncfNumber,
          dueDate: inv.dueDate || '',
          daysOverdue: dOverdue,
          grandTotal: Number(inv.grandTotal || 0),
          status: inv.status,
        };
      });

      const totalOverdueAmount = formattedInvoices.reduce((sum, i) => sum + i.grandTotal, 0);
      const scheduledSuspensionDate = addDays(earliestDueDate, effectiveGraceDays);

      const suspensionMedium = access
        ? this.portRegistry.resolveSuspensionMedium(access)
        : 'NONE';

      const isDeviceOnline = access?.node
        ? access.node.status === 'ACTIVE'
        : access?.onu?.olt
        ? access.onu.olt.connectionStatus === 'CONECTADO'
        : false;

      const item: DelinquentItem = {
        clientId: contract.clientId,
        clientName: client?.name || 'Cliente Desconocido',
        docNumber: client?.docNumber,
        phone: client?.phone,
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        contractStatus: contract.status,
        billingDay: contract.billingDay,
        planName: contract.plan?.name,
        graceDaysOverride: contract.graceDaysOverride,
        effectiveGraceDays,
        daysOverdue: maxDaysOverdue,
        scheduledSuspensionDate,
        overdueInvoicesCount: invoices.length,
        totalOverdueAmount,
        overdueInvoices: formattedInvoices,
        suspensionMedium,
        networkStatus: {
          nodeId: access?.nodeId,
          nodeName: access?.node?.name,
          nodeStatus: access?.node?.status || access?.onu?.olt?.connectionStatus,
          onuId: access?.onuId,
          onuSerial: access?.onu?.serialNumber,
          pendingOperation: access?.pendingOperation,
          isDeviceOnline,
        },
      };

      // Filtros opcionales
      if (query?.minDaysOverdue !== undefined && item.daysOverdue < query.minDaysOverdue) {
        continue;
      }
      if (query?.medium && item.suspensionMedium !== query.medium) {
        continue;
      }
      if (query?.nodeId && item.networkStatus.nodeId !== query.nodeId) {
        continue;
      }
      if (query?.search) {
        const q = query.search.toLowerCase();
        const matchName = item.clientName.toLowerCase().includes(q);
        const matchDoc = item.docNumber?.toLowerCase().includes(q);
        const matchContract = item.contractNumber.toLowerCase().includes(q);
        if (!matchName && !matchDoc && !matchContract) {
          continue;
        }
      }

      items.push(item);
    }

    // Ordenar por días de atraso descendente
    items.sort((a, b) => b.daysOverdue - a.daysOverdue);

    const summary = {
      totalDelinquentContracts: items.length,
      totalOverdueAmount: items.reduce((sum, i) => sum + i.totalOverdueAmount, 0),
      suspendedInEquipment: items.filter((i) => i.contractStatus === 'SUSPENDED').length,
      pendingInQueue: items.filter((i) => !!i.networkStatus.pendingOperation).length,
      withoutEquipment: items.filter((i) => i.suspensionMedium === 'NONE').length,
    };

    return { summary, items };
  }

  async getCarteraVencida(referenceDate: Date = new Date()): Promise<CarteraVencidaReport> {
    const todayStr = this.toDateString(referenceDate);
    const overdueInvoices = await this.invoiceRepository.find({
      where: { status: In(OPEN_INVOICE_STATUSES), dueDate: LessThan(todayStr) },
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
      daysOverdue: invoice.dueDate ? -daysBetween(invoice.dueDate, todayStr) : 0,
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

  private async suspendContract(contract: ContractEntity, daysOverdue: number, invoiceId: string): Promise<void> {
    const reason = `Suspensión automática por morosidad: ${daysOverdue} día(s) de atraso.`;

    // 1. Ejecutamos la suspensión en hardware primero vía ServiceControlService (RF-BILL-002)
    const controlResult = await this.serviceControlService.suspendService(contract.id, {
      process: 'CRON_MOROSIDAD',
      reason,
    });

    // Si el equipo está offline: ServiceControlService ya guardó pendingOperation = 'SUSPEND' y encoló en BullMQ.
    // El contrato sigue ACTIVE en el ERP para no desincronizar hasta que se confirme en el equipo.
    if (!controlResult.applied && controlResult.errorCode === 'NET_DEVICE_OFFLINE') {
      this.logger.warn(
        `Contrato ${contract.contractNumber} (morosidad ${daysOverdue}d): router/OLT offline. Sigue ACTIVE con pendingOperation='SUSPEND'.`,
      );
      return;
    }

    // 2. Si se aplicó (o si el nodo es manual / sin equipo): cambiamos estado en ERP
    contract.status = 'SUSPENDED';
    await this.contractRepository.save(contract);

    await this.suspensionHistoryService.openSuspension({
      contractId: contract.id,
      clientId: contract.clientId,
      reason,
      relatedInvoiceId: invoiceId,
      triggeredByProcess: 'CRON_MOROSIDAD',
    });

    const event: ContractSuspendedEvent = {
      contractId: contract.id,
      clientId: contract.clientId,
      contractNumber: contract.contractNumber,
      daysOverdue,
      reason,
      occurredOn: new Date(),
    };
    this.eventEmitter.emit(SystemEvents.CONTRACT_SUSPENDED, event);
  }

  private toDateString(date: Date): string {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${mm}-${dd}`;
  }
}
