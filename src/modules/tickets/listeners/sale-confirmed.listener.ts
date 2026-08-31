import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TicketsService } from '../tickets.service';
import { SaleConfirmedEvent } from '../../pos/events/sale-confirmed.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';

@Injectable()
export class SaleConfirmedListener {
  private readonly logger = new Logger(SaleConfirmedListener.name);

  constructor(private readonly ticketsService: TicketsService) {}

  @OnEvent(SystemEvents.SALE_CONFIRMED)
  async handleSaleConfirmed(event: SaleConfirmedEvent) {
    this.logger.log(`📥 Evento SALE_CONFIRMED recibido para la venta ${event.saleId} (NCF: ${event.ncfNumber})`);

    try {
      const ticket = await this.ticketsService.createInstallationFromSale(
        event.clientId,
        event.ncfNumber,
      );
      this.logger.log(`✅ Orden de Instalación ${ticket.ticketNumber} creada exitosamente en Tickets.`);
    } catch (error) {
      this.logger.error(`❌ Error al crear orden de instalación para la venta ${event.saleId}:`, error);
    }
  }
}
