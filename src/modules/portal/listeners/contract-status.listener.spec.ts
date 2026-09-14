import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContractStatusListener } from './contract-status.listener';
import { ClientNotificationEntity } from '../entities/client-notification.entity';
import { ContractSuspendedEvent } from '../../billing/events/contract-suspended.event';
import { ContractReactivatedEvent } from '../../billing/events/contract-reactivated.event';
import { ContractTerminatedEvent } from '../../billing/events/contract-terminated.event';

describe('ContractStatusListener', () => {
  let listener: ContractStatusListener;
  let notificationRepo: any;

  beforeEach(async () => {
    notificationRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'notif-1' })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractStatusListener,
        { provide: getRepositoryToken(ClientNotificationEntity), useValue: notificationRepo },
      ],
    }).compile();

    listener = module.get<ContractStatusListener>(ContractStatusListener);
  });

  it('debe estar definido', () => {
    expect(listener).toBeDefined();
  });

  it('crea una notificación SERVICE_SUSPENDED al recibir el evento de suspensión', async () => {
    const event: ContractSuspendedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-0001',
      daysOverdue: 6,
      occurredOn: new Date(),
    };

    await listener.handleContractSuspended(event);

    expect(notificationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', type: 'SERVICE_SUSPENDED' }),
    );
    const created = notificationRepo.create.mock.calls[0][0];
    expect(created.message).toContain('CTR-0001');
    expect(created.message).toContain('6');
  });

  it('crea una notificación SERVICE_REACTIVATED al recibir el evento de reactivación', async () => {
    const event: ContractReactivatedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-0001',
      occurredOn: new Date(),
    };

    await listener.handleContractReactivated(event);

    expect(notificationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', type: 'SERVICE_REACTIVATED' }),
    );
  });

  it('crea una notificación SERVICE_TERMINATED al recibir el evento de terminación', async () => {
    const event: ContractTerminatedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-0001',
      occurredOn: new Date(),
    };

    await listener.handleContractTerminated(event);

    expect(notificationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', type: 'SERVICE_TERMINATED' }),
    );
    const created = notificationRepo.create.mock.calls[0][0];
    expect(created.message).toContain('CTR-0001');
  });

  it('no propaga el error si falla la creación de la notificación', async () => {
    notificationRepo.save.mockRejectedValueOnce(new Error('DB down'));
    const event: ContractSuspendedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-0001',
      daysOverdue: 6,
      occurredOn: new Date(),
    };

    await expect(listener.handleContractSuspended(event)).resolves.not.toThrow();
  });
});
