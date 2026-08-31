import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CrmService } from '../crm.service';
import { SaleConfirmedEvent } from '../../pos/events/sale-confirmed.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';

@Injectable()
export class CrmSaleListener {
  private readonly logger = new Logger(CrmSaleListener.name);

  constructor(private readonly crmService: CrmService) {}

  @OnEvent(SystemEvents.SALE_CONFIRMED)
  async handleSaleConfirmed(event: SaleConfirmedEvent) {
    this.logger.log(`📥 Registrando interacción comercial en CRM para el cliente ${event.clientId}`);
    try {
      await this.crmService.recordSaleInteraction(
        event.clientId,
        event.ncfNumber,
        event.grandTotal,
      );
      this.logger.log(`✅ Interacción de venta registrada en el historial CRM del cliente.`);
    } catch (error) {
      this.logger.error(`❌ Error al registrar interacción en CRM:`, error);
    }
  }
}
