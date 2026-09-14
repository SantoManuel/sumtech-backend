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

  it('suspende el acceso de red al recibir CONTRACT_SUSPENDED, propagando el motivo de negocio', async () => {
    const event: ContractSuspendedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-0001',
      daysOverdue: 6,
      reason: 'Suspensión automática por morosidad: 6 día(s) de atraso.',
      occurredOn: new Date(),
    };

    await listener.handleContractSuspended(event);

    expect(provisioningService.suspend).toHaveBeenCalledWith(
      'contract-1',
      'Suspensión automática por morosidad: 6 día(s) de atraso.',
    );
  });

  it('restaura el acceso de red al recibir CONTRACT_REACTIVATED, propagando el motivo de negocio', async () => {
    const event: ContractReactivatedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-0001',
      reason: 'Reactivación automática: facturas vencidas liquidadas.',
      occurredOn: new Date(),
    };

    await listener.handleContractReactivated(event);

    expect(provisioningService.restore).toHaveBeenCalledWith(
      'contract-1',
      'Reactivación automática: facturas vencidas liquidadas.',
    );
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

  it('no propaga el error si falla la suspensión del acceso de red', async () => {
    provisioningService.suspend.mockRejectedValueOnce(new Error('DB down'));
    const event: ContractSuspendedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-0001',
      daysOverdue: 6,
      reason: 'Suspensión automática por morosidad: 6 día(s) de atraso.',
      occurredOn: new Date(),
    };

    await expect(listener.handleContractSuspended(event)).resolves.not.toThrow();
  });

  it('no propaga el error si falla la restauración del acceso de red', async () => {
    provisioningService.restore.mockRejectedValueOnce(new Error('DB down'));
    const event: ContractReactivatedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-0001',
      reason: 'Reactivación automática: facturas vencidas liquidadas.',
      occurredOn: new Date(),
    };

    await expect(listener.handleContractReactivated(event)).resolves.not.toThrow();
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
