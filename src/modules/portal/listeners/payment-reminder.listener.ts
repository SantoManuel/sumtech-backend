import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientNotificationEntity } from '../entities/client-notification.entity';
import { PaymentReminderEvent } from '../../billing/events/payment-reminder.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';

@Injectable()
export class PaymentReminderListener {
  private readonly logger = new Logger(PaymentReminderListener.name);

  constructor(
    @InjectRepository(ClientNotificationEntity)
    private readonly notificationRepository: Repository<ClientNotificationEntity>,
  ) {}

  @OnEvent(SystemEvents.PAYMENT_REMINDER_DUE)
  async handlePaymentReminderDue(event: PaymentReminderEvent) {
    try {
      const amount = event.grandTotal.toLocaleString('es-DO');
      const isOverdue = event.kind === 'OVERDUE';
      const title = isOverdue ? 'Factura Vencida' : 'Recordatorio de Pago';
      const message = isOverdue
        ? `Tu factura de RD$ ${amount} por "${event.concept}" está vencida hace ${event.daysOverdue} día(s) (venció el ${event.dueDate}). Paga pronto para evitar la suspensión de tu servicio.`
        : `Tu factura de RD$ ${amount} por "${event.concept}" vence el ${event.dueDate}. Recuerda pagarla a tiempo.`;

      await this.notificationRepository.save(
        this.notificationRepository.create({
          clientId: event.clientId,
          title,
          message,
          type: 'PAYMENT_REMINDER',
          link: '/portal/facturas',
        }),
      );
    } catch (error) {
      this.logger.error(
        `Error creando recordatorio de pago para la factura ${event.invoiceId}: ${error.message}`,
        error.stack,
      );
    }
  }
}
