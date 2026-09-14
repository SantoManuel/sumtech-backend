import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { NetworkPlanSpeedChangedListener } from './plan-speed-changed.listener';
import { NetworkProvisioningService } from '../network-provisioning.service';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { PlanSpeedChangedEvent } from '../../plans/events/plan-speed-changed.event';

describe('NetworkPlanSpeedChangedListener', () => {
  let listener: NetworkPlanSpeedChangedListener;
  let contractRepo: any;
  let provisioningService: any;

  const makeEvent = (overrides: Partial<PlanSpeedChangedEvent> = {}): PlanSpeedChangedEvent => ({
    planId: 'plan-1',
    planName: 'Básico 20 Mbps',
    oldSpeedMbps: 20,
    newSpeedMbps: 25,
    occurredOn: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    contractRepo = { find: jest.fn().mockResolvedValue([]) };
    provisioningService = { syncProfileForContract: jest.fn().mockResolvedValue({ id: 'access-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworkPlanSpeedChangedListener,
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: NetworkProvisioningService, useValue: provisioningService },
      ],
    }).compile();

    listener = module.get<NetworkPlanSpeedChangedListener>(NetworkPlanSpeedChangedListener);
  });

  it('debe estar definido', () => {
    expect(listener).toBeDefined();
  });

  it('busca solo contratos ACTIVE/SUSPENDED del plan cuyo speedMbps cambió', async () => {
    await listener.handlePlanSpeedChanged(makeEvent());

    expect(contractRepo.find).toHaveBeenCalledWith({
      where: { planId: 'plan-1', status: In(['ACTIVE', 'SUSPENDED']) },
    });
  });

  it('resincroniza el perfil de red de cada contrato encontrado', async () => {
    contractRepo.find.mockResolvedValue([
      { id: 'contract-1', contractNumber: 'CTR-0001' },
      { id: 'contract-2', contractNumber: 'CTR-0002' },
    ]);

    await listener.handlePlanSpeedChanged(makeEvent());

    expect(provisioningService.syncProfileForContract).toHaveBeenCalledWith('contract-1');
    expect(provisioningService.syncProfileForContract).toHaveBeenCalledWith('contract-2');
    expect(provisioningService.syncProfileForContract).toHaveBeenCalledTimes(2);
  });

  it('no llama a syncProfileForContract si el plan no tiene contratos activos/suspendidos', async () => {
    contractRepo.find.mockResolvedValue([]);

    await listener.handlePlanSpeedChanged(makeEvent());

    expect(provisioningService.syncProfileForContract).not.toHaveBeenCalled();
  });

  it('no propaga el error si falla la búsqueda de contratos', async () => {
    contractRepo.find.mockRejectedValue(new Error('DB down'));

    await expect(listener.handlePlanSpeedChanged(makeEvent())).resolves.not.toThrow();
    expect(provisioningService.syncProfileForContract).not.toHaveBeenCalled();
  });

  it('un contrato que falla no impide que se sincronicen los demás', async () => {
    contractRepo.find.mockResolvedValue([
      { id: 'contract-1', contractNumber: 'CTR-0001' },
      { id: 'contract-2', contractNumber: 'CTR-0002' },
      { id: 'contract-3', contractNumber: 'CTR-0003' },
    ]);
    provisioningService.syncProfileForContract
      .mockResolvedValueOnce({ id: 'access-1' })
      .mockRejectedValueOnce(new Error('RouterOS inalcanzable'))
      .mockResolvedValueOnce({ id: 'access-3' });

    await expect(listener.handlePlanSpeedChanged(makeEvent())).resolves.not.toThrow();

    expect(provisioningService.syncProfileForContract).toHaveBeenCalledTimes(3);
    expect(provisioningService.syncProfileForContract).toHaveBeenCalledWith('contract-3');
  });
});
