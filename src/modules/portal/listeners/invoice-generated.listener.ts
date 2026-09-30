import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientNotificationEntity } from '../entities/client-notification.entity';
import { NotificationTemplateEntity } from '../entities/notification-template.entity';
import { InvoiceGeneratedEvent } from '../../billing/events/invoice-generated.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';
import { interpolateTemplate } from '../utils/template-interpolator.util';
import { CompanyService } from '../../company/company.service';
import { getCurrencySymbolForCurrency } from '../../../common/utils/currency.util';

@Injectable()
export class InvoiceGeneratedListener {
  private readonly logger = new Logger(InvoiceGeneratedListener.name);

  constructor(
    @InjectRepository(ClientNotificationEntity)
    private readonly notificationRepository: Repository<ClientNotificationEntity>,
    @Optional()
    @InjectRepository(NotificationTemplateEntity)
    private readonly templateRepository?: Repository<NotificationTemplateEntity>,
    @Optional()
    private readonly companyService?: CompanyService,
  ) {}

  /** Ver PaymentReminderListener.getDefaultCurrencySymbol — mismo criterio. */
  private async getDefaultCurrencySymbol(): Promise<string> {
    if (!this.companyService) return 'RD$';
    try {
      const profile = await this.companyService.getProfile();
      return getCurrencySymbolForCurrency(profile.currency);
    } catch {
      return 'RD$';
    }
  }

  @OnEvent(SystemEvents.INVOICE_GENERATED)
  async handleInvoiceGenerated(event: InvoiceGeneratedEvent) {
    try {
      let title = 'Nueva Factura Generada';
      let currencySymbol = await this.getDefaultCurrencySymbol();
      const formattedAmount = event.grandTotal.toLocaleString('es-DO');

      let template: NotificationTemplateEntity | null = null;
      if (this.templateRepository) {
        try {
          template = await this.templateRepository.findOne({
            where: { eventType: 'INVOICE_GENERATED', isActive: true },
          });
        } catch (tErr: any) {
          this.logger.warn(`No se pudo cargar la plantilla para INVOICE_GENERATED: ${tErr?.message}`);
        }
      }

      if (template?.currencySymbol) {
        currencySymbol = template.currencySymbol;
      }

      let message = `Se generó tu factura de ${currencySymbol} ${formattedAmount} por "${event.concept}". Fecha límite de pago: ${event.dueDate}.`;

      if (template) {
        const variables = {
          monto: formattedAmount,
          moneda: currencySymbol,
          concepto: event.concept,
          fechaVencimiento: event.dueDate,
          facturaId: event.invoiceId,
        };
        title = interpolateTemplate(template.titleTemplate, variables);
        message = interpolateTemplate(template.bodyTemplate, variables);
      }

      await this.notificationRepository.save(
        this.notificationRepository.create({
          clientId: event.clientId,
          title,
          message,
          type: 'INVOICE_GENERATED',
          link: '/portal/facturas',
        }),
      );
    } catch (error: any) {
      this.logger.error(
        `Error creando notificación para la factura ${event.invoiceId}: ${error?.message}`,
        error?.stack,
      );
    }
  }
}

