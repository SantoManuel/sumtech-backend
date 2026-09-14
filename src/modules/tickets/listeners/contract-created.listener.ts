import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TicketsService } from '../tickets.service';
import { ContractCreatedEvent } from '../../billing/events/contract-created.event';
import { SystemEvents } from '../../../common/enums/system-events.enum';

@Injectable()
export class ContractCreatedListener {
  private readonly logger = new Logger(ContractCreatedListener.name);

  constructor(private readonly ticketsService: TicketsService) {}

  @OnEvent(SystemEvents.CONTRACT_CREATED)
  async handleContractCreated(event: ContractCreatedEvent) {
    this.logger.log(`📥 Evento CONTRACT_CREATED recibido para el contrato ${event.contractNumber}`);

    try {
      const ticket = await this.ticketsService.createInstallationFromContract(
        event.clientId,
        event.contractId,
        event.contractNumber,
      );
      this.logger.log(`✅ Orden de Instalación ${ticket.ticketNumber} creada exitosamente en Tickets.`);
    } catch (error) {
      this.logger.error(`❌ Error al crear orden de instalación para el contrato ${event.contractNumber}:`, error);
    }
  }
}
