import { Test, TestingModule } from '@nestjs/testing';
import { ContractCreatedListener } from './contract-created.listener';
import { TicketsService } from '../tickets.service';
import { ContractCreatedEvent } from '../../billing/events/contract-created.event';

describe('ContractCreatedListener', () => {
  let listener: ContractCreatedListener;
  let ticketsService: any;

  beforeEach(async () => {
    ticketsService = {
      createInstallationFromContract: jest.fn().mockResolvedValue({ id: 'ticket-1', ticketNumber: 'TCK-000001' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ContractCreatedListener, { provide: TicketsService, useValue: ticketsService }],
    }).compile();

    listener = module.get<ContractCreatedListener>(ContractCreatedListener);
  });

  it('debe estar definido', () => {
    expect(listener).toBeDefined();
  });

  it('crea la orden de instalación enlazada al contrato al recibir CONTRACT_CREATED', async () => {
    const event: ContractCreatedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-000123',
      occurredOn: new Date(),
    };

    await listener.handleContractCreated(event);

    expect(ticketsService.createInstallationFromContract).toHaveBeenCalledWith(
      'client-1',
      'contract-1',
      'CTR-000123',
    );
  });

  it('no propaga el error si falla la creación del ticket', async () => {
    ticketsService.createInstallationFromContract.mockRejectedValueOnce(new Error('DB down'));
    const event: ContractCreatedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-000123',
      occurredOn: new Date(),
    };

    await expect(listener.handleContractCreated(event)).resolves.not.toThrow();
  });
});
