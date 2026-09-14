import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientNotificationEntity } from '../entities/client-notification.entity';
import { InvoiceGeneratedEvent } from '../../billing/events/invoice-generated.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';

@Injectable()
export class InvoiceGeneratedListener {
  private readonly logger = new Logger(InvoiceGeneratedListener.name);

  constructor(
    @InjectRepository(ClientNotificationEntity)
    private readonly notificationRepository: Repository<ClientNotificationEntity>,
  ) {}

  @OnEvent(SystemEvents.INVOICE_GENERATED)
  async handleInvoiceGenerated(event: InvoiceGeneratedEvent) {
    try {
      await this.notificationRepository.save(
        this.notificationRepository.create({
          clientId: event.clientId,
          title: 'Nueva Factura Generada',
          message: `Se generó tu factura de RD$ ${event.grandTotal.toLocaleString('es-DO')} por "${event.concept}". Fecha límite de pago: ${event.dueDate}.`,
          type: 'INVOICE_GENERATED',
          link: '/portal/facturas',
        }),
      );
    } catch (error) {
      this.logger.error(
        `Error creando notificación para la factura ${event.invoiceId}: ${error.message}`,
        error.stack,
      );
    }
  }
}
