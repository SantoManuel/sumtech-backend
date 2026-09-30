import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SystemEvents } from '../../../common/enums/system-events.enum';
import { InvoicePaidEvent } from '../events/invoice-paid.event';
import { MorosidadService } from '../morosidad.service';

/**
 * ARCHIVO: src/modules/billing/listeners/billing-reactivation.listener.ts
 * CAPA: Listener de Dominio / Event Driven Architecture (Fase 7 - RF-BILL-003 / PPPOE-007)
 * RESPONSABILIDAD:
 * Escucha el evento global SystemEvents.INVOICE_PAID (disparado tras cobro en POS, portal o depósitos)
 * y evalúa si el contrato asociado está completamente al día para solicitar su reactivación automática
 * inmediata a través de MorosidadService -> ServiceControlService.
 */
@Injectable()
export class BillingReactivationListener {
  private readonly logger = new Logger(BillingReactivationListener.name);

  constructor(private readonly morosidadService: MorosidadService) {}

  @OnEvent(SystemEvents.INVOICE_PAID)
  async handleInvoicePaid(event: InvoicePaidEvent): Promise<void> {
    if (!event.contractId) {
      return;
    }

    try {
      this.logger.log(
        `[INVOICE_PAID] Factura ${event.invoiceId} liquidada. Evaluando reactivación para contrato ${event.contractId}...`,
      );
      const reactivated = await this.morosidadService.reactivateIfSettled(event.contractId);
      if (reactivated) {
        this.logger.log(
          `[INVOICE_PAID] Contrato ${event.contractId} reactivado exitosamente tras pago de factura ${event.invoiceId}.`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Error procesando reactivación tras pago de factura ${event.invoiceId} (contrato ${event.contractId}): ${error.message}`,
        error.stack,
      );
    }
  }
}
