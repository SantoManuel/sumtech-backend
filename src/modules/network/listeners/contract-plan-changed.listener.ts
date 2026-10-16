import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NetworkProvisioningService } from '../network-provisioning.service';
import { PppManagementService } from '../services/ppp-management.service';
import { ContractPlanChangedEvent } from '../../billing/events/contract-plan-changed.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';

/**
 * Fase 07 del plan de integración con Mikrotik: cuando un contrato cambia de
 * plan, sincroniza el perfil de velocidad en el nodo real y opcionalmente
 * reconecta la sesión activa para aplicar el nuevo rate-limit de inmediato.
 */
@Injectable()
export class NetworkContractPlanChangedListener {
  private readonly logger = new Logger(NetworkContractPlanChangedListener.name);

  constructor(
    private readonly provisioningService: NetworkProvisioningService,
    private readonly pppManagementService: PppManagementService,
  ) {}

  @OnEvent(SystemEvents.CONTRACT_PLAN_CHANGED)
  async handleContractPlanChanged(event: ContractPlanChangedEvent) {
    try {
      const access = await this.provisioningService.syncProfileForContract(event.contractId);
      if (access && access.id && access.nodeId && access.username) {
        try {
          await this.pppManagementService.disconnectAccessSession(access.id);
          this.logger.log(`Sesión activa de "${access.username}" expulsada para aplicar nueva velocidad del plan.`);
        } catch (kickError: any) {
          this.logger.warn(`No se pudo expulsar la sesión activa tras cambio de plan: ${kickError.message}`);
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Error sincronizando el perfil de red tras el cambio de plan del contrato ${event.contractNumber}: ${error.message}`,
        error.stack,
      );
    }
  }
}
