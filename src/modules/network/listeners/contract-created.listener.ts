import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NetworkProvisioningService } from '../network-provisioning.service';
import { ContractCreatedEvent } from '../../billing/events/contract-created.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';

@Injectable()
export class NetworkContractCreatedListener {
  private readonly logger = new Logger(NetworkContractCreatedListener.name);

  constructor(private readonly provisioningService: NetworkProvisioningService) {}

  @OnEvent(SystemEvents.CONTRACT_CREATED)
  async handleContractCreated(event: ContractCreatedEvent) {
    try {
      await this.provisioningService.createAccessForContract(event.contractId);
    } catch (error) {
      this.logger.error(
        `Error creando el acceso de red para el contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }
}
