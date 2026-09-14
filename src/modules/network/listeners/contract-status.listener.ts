import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NetworkProvisioningService } from '../network-provisioning.service';
import { ContractSuspendedEvent } from '../../billing/events/contract-suspended.event';
import { ContractReactivatedEvent } from '../../billing/events/contract-reactivated.event';
import { ContractTerminatedEvent } from '../../billing/events/contract-terminated.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';

/**
 * Traduce transiciones de estado comercial del contrato a acciones sobre su
 * acceso de red. Es el único punto donde el dominio de red reacciona a
 * decisiones de negocio (morosidad, terminación) — nunca al revés.
 */
@Injectable()
export class NetworkContractStatusListener {
  private readonly logger = new Logger(NetworkContractStatusListener.name);

  constructor(private readonly provisioningService: NetworkProvisioningService) {}

  @OnEvent(SystemEvents.CONTRACT_SUSPENDED)
  async handleContractSuspended(event: ContractSuspendedEvent) {
    try {
      await this.provisioningService.suspend(event.contractId, event.reason);
    } catch (error) {
      this.logger.error(
        `Error suspendiendo el acceso de red del contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent(SystemEvents.CONTRACT_REACTIVATED)
  async handleContractReactivated(event: ContractReactivatedEvent) {
    try {
      await this.provisioningService.restore(event.contractId, event.reason);
    } catch (error) {
      this.logger.error(
        `Error restaurando el acceso de red del contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent(SystemEvents.CONTRACT_TERMINATED)
  async handleContractTerminated(event: ContractTerminatedEvent) {
    try {
      await this.provisioningService.deprovision(event.contractId, event.reason);
    } catch (error) {
      this.logger.error(
        `Error cortando el acceso de red del contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }
}
