import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SystemEvents } from '../../../common/enums/system-events.enum';
import { ContractSuspendedEvent } from '../../billing/events/contract-suspended.event';
import { ContractReactivatedEvent } from '../../billing/events/contract-reactivated.event';
import { GenieAcsProvisioningService } from '../services/genieacs-provisioning.service';

/**
 * Listener de ciclo de vida de contratos para suspensión y reactivación en GenieACS.
 * Reacciona a transiciones comerciales (morosidad o reactivación por pago)
 * orquestando el tag STATUS:SUSPENDIDO y refresh en los CPEs TR-069.
 */
@Injectable()
export class GenieAcsContractEventListener {
  private readonly logger = new Logger(GenieAcsContractEventListener.name);

  constructor(private readonly provisioningService: GenieAcsProvisioningService) {}

  @OnEvent(SystemEvents.CONTRACT_SUSPENDED)
  async handleContractSuspended(event: ContractSuspendedEvent) {
    try {
      this.logger.log(
        `[GenieACS Listener] Procesando suspensión para contrato ${event.contractNumber} (${event.contractId})`,
      );
      await this.provisioningService.suspendService(event.contractId);
    } catch (error: any) {
      this.logger.error(
        `[GenieACS Listener] Error procesando suspensión para contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent(SystemEvents.CONTRACT_REACTIVATED)
  async handleContractReactivated(event: ContractReactivatedEvent) {
    try {
      this.logger.log(
        `[GenieACS Listener] Procesando reactivación para contrato ${event.contractNumber} (${event.contractId})`,
      );
      await this.provisioningService.reactivateService(event.contractId);
    } catch (error: any) {
      this.logger.error(
        `[GenieACS Listener] Error procesando reactivación para contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }
}
