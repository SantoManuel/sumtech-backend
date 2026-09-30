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

  // CONTRACT_SUSPENDED y CONTRACT_REACTIVATED son operados de forma confirmada y previa
  // por ServiceControlService (§1.5). Este listener conserva exclusivamente el corte por terminación.

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
