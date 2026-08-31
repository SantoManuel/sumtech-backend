import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContractEntity } from '../clients/entities/contract.entity';
import { TicketResolvedEvent } from '../tickets/events/ticket-resolved.event';
import { ServiceActivatedEvent } from './events/service-activated.event';
import { SystemEvents } from '../../common/enums/system-events.enum';

@Injectable()
export class CoordinationService {
  private readonly logger = new Logger(CoordinationService.name);

  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(SystemEvents.TICKET_RESOLVED)
  async handleTicketResolved(event: TicketResolvedEvent) {
    this.logger.log(`📥 Orden Técnica ${event.ticketId} resuelta. Verificando activación de servicio...`);

    if (event.type === 'INSTALLATION' && event.contractId) {
      const contract = await this.contractRepository.findOneBy({ id: event.contractId });
      if (contract && contract.status === 'PENDING_INSTALL') {
        contract.status = 'ACTIVE';
        await this.contractRepository.save(contract);
        this.logger.log(`🎉 Contrato ${contract.contractNumber} activado exitosamente en estado ACTIVE.`);

        const activationEvent: ServiceActivatedEvent = {
          contractId: contract.id,
          clientId: contract.clientId,
          activatedAt: new Date(),
        };

        this.eventEmitter.emit(SystemEvents.SERVICE_ACTIVATED, activationEvent);
      }
    }
  }
}
