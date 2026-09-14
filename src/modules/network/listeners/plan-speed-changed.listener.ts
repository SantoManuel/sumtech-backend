import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NetworkProvisioningService } from '../network-provisioning.service';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { PlanSpeedChangedEvent } from '../../plans/events/plan-speed-changed.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';

/**
 * Cierra un hueco real: editar el speedMbps de un plan YA existente no
 * cambiaba nada para los contratos que ya estaban en ese plan (solo un
 * cambio de plan por contrato disparaba la sincronización — ver
 * NetworkContractPlanChangedListener). Este listener resincroniza el perfil
 * de velocidad de TODOS los contratos activos/suspendidos de ese plan cuando
 * su velocidad cambia, uno por uno — un fallo en un contrato no debe impedir
 * que los demás se sincronicen.
 */
@Injectable()
export class NetworkPlanSpeedChangedListener {
  private readonly logger = new Logger(NetworkPlanSpeedChangedListener.name);

  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    private readonly provisioningService: NetworkProvisioningService,
  ) {}

  @OnEvent(SystemEvents.PLAN_SPEED_CHANGED)
  async handlePlanSpeedChanged(event: PlanSpeedChangedEvent): Promise<void> {
    let contracts: ContractEntity[];
    try {
      contracts = await this.contractRepository.find({
        where: { planId: event.planId, status: In(['ACTIVE', 'SUSPENDED']) },
      });
    } catch (error) {
      this.logger.error(
        `Error buscando los contratos del plan "${event.planName}" para resincronizar sus perfiles de red: ${error.message}`,
        error.stack,
      );
      return;
    }

    for (const contract of contracts) {
      try {
        await this.provisioningService.syncProfileForContract(contract.id);
      } catch (error) {
        this.logger.error(
          `Error resincronizando el perfil de red del contrato ${contract.contractNumber} tras el cambio de velocidad del plan "${event.planName}": ${error.message}`,
          error.stack,
        );
      }
    }
  }
}
