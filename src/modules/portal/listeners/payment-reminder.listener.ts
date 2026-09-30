import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientNotificationEntity } from '../entities/client-notification.entity';
import { NotificationTemplateEntity } from '../entities/notification-template.entity';
import { PaymentReminderEvent } from '../../billing/events/payment-reminder.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';
import { interpolateTemplate } from '../utils/template-interpolator.util';
import { CompanyService } from '../../company/company.service';
import { getCurrencySymbolForCurrency } from '../../../common/utils/currency.util';

@Injectable()
export class PaymentReminderListener {
  private readonly logger = new Logger(PaymentReminderListener.name);

  constructor(
    @InjectRepository(ClientNotificationEntity)
    private readonly notificationRepository: Repository<ClientNotificationEntity>,
    @Optional()
    @InjectRepository(NotificationTemplateEntity)
    private readonly templateRepository?: Repository<NotificationTemplateEntity>,
    @Optional()
    private readonly companyService?: CompanyService,
  ) {}

  /**
   * Moneda real del tenant (CompanyProfileEntity.currency) como valor por
   * defecto — antes esto era el literal 'RD$' fijo, desincronizado de lo que
   * el tenant configuró en /dashboard/empresa. `@Optional()` porque este
   * listener puede correr en contextos sin CompanyModule disponible (tests).
   */
  private async getDefaultCurrencySymbol(): Promise<string> {
    if (!this.companyService) return 'RD$';
    try {
      const profile = await this.companyService.getProfile();
      return getCurrencySymbolForCurrency(profile.currency);
    } catch {
      return 'RD$';
    }
  }

  @OnEvent(SystemEvents.PAYMENT_REMINDER_DUE)
  async handlePaymentReminderDue(event: PaymentReminderEvent) {
    try {
      const amount = event.grandTotal.toLocaleString('es-DO');
      const isOverdue = event.kind === 'OVERDUE';
      const eventType = isOverdue ? 'PAYMENT_REMINDER_OVERDUE' : 'PAYMENT_REMINDER_DUE';

      // Por defecto se deriva de CompanyProfileEntity.currency, no un literal
      // 'RD$' fijo — una plantilla explícita (currencySymbol seteado a mano)
      // sigue ganando sobre este default, ver más abajo.
      let currencySymbol = await this.getDefaultCurrencySymbol();
      let title = isOverdue ? 'Factura Vencida' : 'Recordatorio de Pago';
      let message = isOverdue
        ? `Tu factura de RD$ ${amount} por "${event.concept}" está vencida hace ${event.daysOverdue} día(s) (venció el ${event.dueDate}). Paga pronto para evitar la suspensión de tu servicio.`
        : `Tu factura de RD$ ${amount} por "${event.concept}" vence el ${event.dueDate}. Recuerda pagarla a tiempo.`;

      let template: NotificationTemplateEntity | null = null;
      if (this.templateRepository) {
        try {
          template = await this.templateRepository.findOne({
            where: { eventType, isActive: true },
          });
        } catch (tErr: any) {
          this.logger.warn(`No se pudo cargar la plantilla para ${eventType}: ${tErr?.message}`);
        }
      }

      if (template?.currencySymbol) {
        currencySymbol = template.currencySymbol;
      }

      if (template) {
        const variables = {
          monto: amount,
          moneda: currencySymbol,
          concepto: event.concept,
          fechaVencimiento: event.dueDate,
          diasVencida: event.daysOverdue ?? 0,
          facturaId: event.invoiceId,
        };
        title = interpolateTemplate(template.titleTemplate, variables);
        message = interpolateTemplate(template.bodyTemplate, variables);
      } else if (currencySymbol !== 'RD$') {
        message = message.replace('RD$', currencySymbol);
      }

      await this.notificationRepository.save(
        this.notificationRepository.create({
          clientId: event.clientId,
          title,
          message,
          type: 'PAYMENT_REMINDER',
          link: '/portal/facturas',
        }),
      );
    } catch (error: any) {
      this.logger.error(
        `Error creando recordatorio de pago para la factura ${event.invoiceId}: ${error?.message}`,
        error?.stack,
      );
    }
  }
}

