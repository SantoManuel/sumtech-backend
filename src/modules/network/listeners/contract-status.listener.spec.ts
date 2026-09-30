import { Test, TestingModule } from '@nestjs/testing';
import { NetworkContractStatusListener } from './contract-status.listener';
import { NetworkProvisioningService } from '../network-provisioning.service';
import { ContractSuspendedEvent } from '../../billing/events/contract-suspended.event';
import { ContractReactivatedEvent } from '../../billing/events/contract-reactivated.event';
import { ContractTerminatedEvent } from '../../billing/events/contract-terminated.event';

describe('NetworkContractStatusListener', () => {
  let listener: NetworkContractStatusListener;
  let provisioningService: any;

  beforeEach(async () => {
    provisioningService = {
      suspend: jest.fn().mockResolvedValue({ id: 'access-1', connectionStatus: 'SUSPENDED' }),
      restore: jest.fn().mockResolvedValue({ id: 'access-1', connectionStatus: 'ACTIVE' }),
      deprovision: jest.fn().mockResolvedValue({ id: 'access-1', connectionStatus: 'CUT' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworkContractStatusListener,
        { provide: NetworkProvisioningService, useValue: provisioningService },
      ],
    }).compile();

    listener = module.get<NetworkContractStatusListener>(NetworkContractStatusListener);
  });

  it('debe estar definido', () => {
    expect(listener).toBeDefined();
  });

  it('corta el acceso de red al recibir CONTRACT_TERMINATED, propagando el motivo de negocio', async () => {
    const event: ContractTerminatedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-0001',
      reason: 'Terminación manual por administrador.',
      occurredOn: new Date(),
    };

    await listener.handleContractTerminated(event);

    expect(provisioningService.deprovision).toHaveBeenCalledWith('contract-1', 'Terminación manual por administrador.');
  });

  it('no propaga el error si falla el corte del acceso de red', async () => {
    provisioningService.deprovision.mockRejectedValueOnce(new Error('DB down'));
    const event: ContractTerminatedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-0001',
      reason: 'Terminación manual por administrador.',
      occurredOn: new Date(),
    };

    await expect(listener.handleContractTerminated(event)).resolves.not.toThrow();
  });
});
