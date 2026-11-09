import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NetworkProvisioningService } from '../network-provisioning.service';
import { ContractCreatedEvent } from '../../billing/events/contract-created.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';
import { GenieAcsProvisioningService } from '../../genieacs/services/genieacs-provisioning.service';

@Injectable()
export class NetworkContractCreatedListener {
  private readonly logger = new Logger(NetworkContractCreatedListener.name);

  constructor(
    private readonly provisioningService: NetworkProvisioningService,
    @Optional()
    private readonly genieAcsProvisioning?: GenieAcsProvisioningService,
  ) {}

  @OnEvent(SystemEvents.CONTRACT_CREATED)
  async handleContractCreated(event: ContractCreatedEvent) {
    try {
      await this.provisioningService.createAccessForContract(event.contractId);
    } catch (error: any) {
      this.logger.error(
        `Error creando el acceso de red para el contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }

    if (this.genieAcsProvisioning) {
      try {
        await this.genieAcsProvisioning.assignCustomerPlan(event.contractId, event.clientId);
      } catch (error: any) {
        this.logger.error(
          `Error asignando tags GenieACS al crear contrato ${event.contractNumber}: ${error.message}`,
          error.stack,
        );
      }
    }
  }
}
