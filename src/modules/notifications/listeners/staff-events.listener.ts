import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SystemEvents } from '../../../common/enums/system-events.enum';
import { StaffNotificationService } from '../notifications.service';

@Injectable()
export class StaffEventsListener {
  private readonly logger = new Logger(StaffEventsListener.name);

  constructor(private readonly staffNotificationService: StaffNotificationService) {}

  @OnEvent(SystemEvents.STOCK_LOW_ALERT)
  async handleStockLowAlert(payload: {
    productId: string;
    productName: string;
    sku?: string;
    stockCurrent: number;
    stockMinimum: number;
    tenantId?: string;
  }) {
    try {
      this.logger.log(`Alerta de stock bajo para producto: ${payload.productName} (${payload.stockCurrent}/${payload.stockMinimum})`);
      await this.staffNotificationService.createAndEmit(
        {
          category: 'INVENTORY',
          severity: 'WARNING',
          title: `Stock Crítico: ${payload.productName}`,
          message: `El producto ${payload.productName} (SKU: ${payload.sku || 'N/A'}) tiene ${payload.stockCurrent} unidad(es) restante(s), por debajo del stock mínimo (${payload.stockMinimum}).`,
          link: '/dashboard/inventario',
          targetRole: 'ADMIN',
          metadata: {
            productId: payload.productId,
            stockCurrent: payload.stockCurrent,
            stockMinimum: payload.stockMinimum,
          },
        },
        payload.tenantId || 'default',
      );
    } catch (err: any) {
      this.logger.error(`Error procesando alerta de stock bajo: ${err.message}`);
    }
  }

  @OnEvent(SystemEvents.TICKET_CREATED)
  async handleTicketCreated(payload: {
    ticketId: string;
    ticketNumber?: string;
    title: string;
    type: string;
    priority?: string;
    assignedUserId?: string;
    tenantId?: string;
  }) {
    try {
      this.logger.log(`Alerta de nuevo ticket creado: ${payload.title}`);
      await this.staffNotificationService.createAndEmit(
        {
          userId: payload.assignedUserId || null,
          targetRole: payload.assignedUserId ? undefined : 'TECNICO',
          category: 'OPERATIONS',
          severity: payload.priority === 'CRITICAL' ? 'CRITICAL' : 'INFO',
          title: `Nuevo Ticket: ${payload.ticketNumber || payload.title}`,
          message: `Se ha abierto un ticket de tipo ${payload.type}: "${payload.title}". Prioridad: ${payload.priority || 'NORMAL'}.`,
          link: '/dashboard/tickets',
          metadata: { ticketId: payload.ticketId },
        },
        payload.tenantId || 'default',
      );
    } catch (err: any) {
      this.logger.error(`Error procesando alerta de ticket creado: ${err.message}`);
    }
  }

  @OnEvent(SystemEvents.CONTRACT_SUSPENDED)
  async handleContractSuspended(payload: {
    contractId: string;
    contractNumber: string;
    clientName?: string;
    tenantId?: string;
  }) {
    try {
      await this.staffNotificationService.createAndEmit(
        {
          targetRole: 'ALL',
          category: 'OPERATIONS',
          severity: 'CRITICAL',
          title: `Contrato Suspendido: ${payload.contractNumber}`,
          message: `El contrato ${payload.contractNumber} (${payload.clientName || 'Cliente'}) ha sido suspendido por mora o corte de servicio.`,
          link: '/dashboard/contratos',
          metadata: { contractId: payload.contractId },
        },
        payload.tenantId || 'default',
      );
    } catch (err: any) {
      this.logger.error(`Error procesando alerta de contrato suspendido: ${err.message}`);
    }
  }

  @OnEvent(SystemEvents.SALE_CONFIRMED)
  async handleSaleConfirmed(payload: {
    saleId: string;
    invoiceNumber?: string;
    grandTotal: number;
    cashierName?: string;
    tenantId?: string;
  }) {
    try {
      await this.staffNotificationService.createAndEmit(
        {
          targetRole: 'GERENTE',
          category: 'BILLING',
          severity: 'SUCCESS',
          title: `Venta Confirmada: RD$ ${Number(payload.grandTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`,
          message: `Se registró cobro fiscal #${payload.invoiceNumber || payload.saleId} por ${payload.cashierName || 'Caja'}.`,
          link: '/dashboard/facturas',
          metadata: { saleId: payload.saleId },
        },
        payload.tenantId || 'default',
      );
    } catch (err: any) {
      this.logger.error(`Error procesando alerta de venta confirmada: ${err.message}`);
    }
  }
}
