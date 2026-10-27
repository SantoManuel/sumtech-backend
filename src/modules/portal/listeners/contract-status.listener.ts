import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientNotificationEntity } from '../entities/client-notification.entity';
import { ContractSuspendedEvent } from '../../billing/events/contract-suspended.event';
import { ContractReactivatedEvent } from '../../billing/events/contract-reactivated.event';
import { ContractTerminatedEvent } from '../../billing/events/contract-terminated.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';
import { NotificationsGateway } from '../../notifications/gateways/notifications.gateway';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { Optional } from '@nestjs/common';

@Injectable()
export class ContractStatusListener {
  private readonly logger = new Logger(ContractStatusListener.name);

  constructor(
    @InjectRepository(ClientNotificationEntity)
    private readonly notificationRepository: Repository<ClientNotificationEntity>,
    @Optional()
    private readonly notificationsGateway?: NotificationsGateway,
    @Optional()
    private readonly tenantContext?: TenantContextService,
  ) {}

  @OnEvent(SystemEvents.CONTRACT_SUSPENDED)
  async handleContractSuspended(event: ContractSuspendedEvent) {
    try {
      const saved = await this.notificationRepository.save(
        this.notificationRepository.create({
          clientId: event.clientId,
          title: 'Servicio Suspendido',
          message: `Tu contrato ${event.contractNumber} fue suspendido por facturas vencidas hace ${event.daysOverdue} día(s). Paga tus facturas pendientes para reactivar tu servicio.`,
          type: 'SERVICE_SUSPENDED',
          link: '/portal/facturas',
        }),
      );

      const tenantId = this.tenantContext?.hasContext() ? this.tenantContext.getTenantId() : 'default';
      if (this.notificationsGateway) {
        this.notificationsGateway.emitClientNotification(tenantId, event.clientId, saved);
      }
    } catch (error: any) {
      this.logger.error(
        `Error creando notificación de suspensión para el contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent(SystemEvents.CONTRACT_REACTIVATED)
  async handleContractReactivated(event: ContractReactivatedEvent) {
    try {
      const saved = await this.notificationRepository.save(
        this.notificationRepository.create({
          clientId: event.clientId,
          title: 'Servicio Reactivado',
          message: `Tu contrato ${event.contractNumber} fue reactivado tras liquidar tus facturas pendientes. ¡Gracias por tu pago!`,
          type: 'SERVICE_REACTIVATED',
          link: '/portal/dashboard',
        }),
      );

      const tenantId = this.tenantContext?.hasContext() ? this.tenantContext.getTenantId() : 'default';
      if (this.notificationsGateway) {
        this.notificationsGateway.emitClientNotification(tenantId, event.clientId, saved);
      }
    } catch (error: any) {
      this.logger.error(
        `Error creando notificación de reactivación para el contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent(SystemEvents.CONTRACT_TERMINATED)
  async handleContractTerminated(event: ContractTerminatedEvent) {
    try {
      const saved = await this.notificationRepository.save(
        this.notificationRepository.create({
          clientId: event.clientId,
          title: 'Servicio Terminado',
          message: `Tu contrato ${event.contractNumber} ha sido terminado. Si crees que esto es un error, contacta a soporte.`,
          type: 'SERVICE_TERMINATED',
          link: '/portal/dashboard',
        }),
      );

      const tenantId = this.tenantContext?.hasContext() ? this.tenantContext.getTenantId() : 'default';
      if (this.notificationsGateway) {
        this.notificationsGateway.emitClientNotification(tenantId, event.clientId, saved);
      }
    } catch (error: any) {
      this.logger.error(
        `Error creando notificación de terminación para el contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }
}
