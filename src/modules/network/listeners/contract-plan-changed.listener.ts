import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NetworkProvisioningService } from '../network-provisioning.service';
import { ContractPlanChangedEvent } from '../../billing/events/contract-plan-changed.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';

/**
 * Fase 07 del plan de integración con Mikrotik: cuando un contrato cambia de
 * plan, sincroniza el perfil de velocidad en el nodo real — sin esto, un
 * upgrade/downgrade de plan quedaría registrado en Sumtech pero el cliente
 * seguiría navegando a la velocidad del plan anterior.
 */
@Injectable()
export class NetworkContractPlanChangedListener {
  private readonly logger = new Logger(NetworkContractPlanChangedListener.name);

  constructor(private readonly provisioningService: NetworkProvisioningService) {}

  @OnEvent(SystemEvents.CONTRACT_PLAN_CHANGED)
  async handleContractPlanChanged(event: ContractPlanChangedEvent) {
    try {
      await this.provisioningService.syncProfileForContract(event.contractId);
    } catch (error) {
      this.logger.error(
        `Error sincronizando el perfil de red tras el cambio de plan del contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }
}
