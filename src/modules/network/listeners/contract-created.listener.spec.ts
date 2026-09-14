import { Test, TestingModule } from '@nestjs/testing';
import { NetworkContractCreatedListener } from './contract-created.listener';
import { NetworkProvisioningService } from '../network-provisioning.service';
import { ContractCreatedEvent } from '../../billing/events/contract-created.event';

describe('NetworkContractCreatedListener', () => {
  let listener: NetworkContractCreatedListener;
  let provisioningService: any;

  beforeEach(async () => {
    provisioningService = {
      createAccessForContract: jest.fn().mockResolvedValue({ id: 'access-1', connectionStatus: 'PENDING' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworkContractCreatedListener,
        { provide: NetworkProvisioningService, useValue: provisioningService },
      ],
    }).compile();

    listener = module.get<NetworkContractCreatedListener>(NetworkContractCreatedListener);
  });

  it('debe estar definido', () => {
    expect(listener).toBeDefined();
  });

  it('crea el acceso de red del contrato al recibir CONTRACT_CREATED', async () => {
    const event: ContractCreatedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-000123',
      occurredOn: new Date(),
    };

    await listener.handleContractCreated(event);

    expect(provisioningService.createAccessForContract).toHaveBeenCalledWith('contract-1');
  });

  it('no propaga el error si falla la creación del acceso de red', async () => {
    provisioningService.createAccessForContract.mockRejectedValueOnce(new Error('DB down'));
    const event: ContractCreatedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-000123',
      occurredOn: new Date(),
    };

    await expect(listener.handleContractCreated(event)).resolves.not.toThrow();
  });
});
