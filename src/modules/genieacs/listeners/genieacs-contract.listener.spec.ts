import { Test, TestingModule } from '@nestjs/testing';
import { GenieAcsContractEventListener } from './genieacs-contract.listener';
import { GenieAcsProvisioningService } from '../services/genieacs-provisioning.service';
import { ContractSuspendedEvent } from '../../billing/events/contract-suspended.event';
import { ContractReactivatedEvent } from '../../billing/events/contract-reactivated.event';

describe('GenieAcsContractEventListener', () => {
  let listener: GenieAcsContractEventListener;
  let mockProvisioningService: any;

  beforeEach(async () => {
    mockProvisioningService = {
      suspendService: jest.fn().mockResolvedValue({ success: true }),
      reactivateService: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenieAcsContractEventListener,
        {
          provide: GenieAcsProvisioningService,
          useValue: mockProvisioningService,
        },
      ],
    }).compile();

    listener = module.get<GenieAcsContractEventListener>(GenieAcsContractEventListener);
  });

  it('handleContractSuspended debe llamar a suspendService con el contractId', async () => {
    const event: ContractSuspendedEvent = {
      contractId: 'contract-uuid-1',
      clientId: 'client-1',
      contractNumber: 'CNT-001',
      daysOverdue: 15,
      reason: 'Falta de pago',
      occurredOn: new Date(),
    };

    await listener.handleContractSuspended(event);

    expect(mockProvisioningService.suspendService).toHaveBeenCalledWith('contract-uuid-1');
  });

  it('handleContractReactivated debe llamar a reactivateService con el contractId', async () => {
    const event: ContractReactivatedEvent = {
      contractId: 'contract-uuid-1',
      clientId: 'client-1',
      contractNumber: 'CNT-001',
      reason: 'Pago realizado',
      occurredOn: new Date(),
    };

    await listener.handleContractReactivated(event);

    expect(mockProvisioningService.reactivateService).toHaveBeenCalledWith('contract-uuid-1');
  });
});

