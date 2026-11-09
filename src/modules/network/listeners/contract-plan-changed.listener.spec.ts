import { Test, TestingModule } from '@nestjs/testing';
import { NetworkContractPlanChangedListener } from './contract-plan-changed.listener';
import { NetworkProvisioningService } from '../network-provisioning.service';
import { ContractPlanChangedEvent } from '../../billing/events/contract-plan-changed.event';
import { PppManagementService } from '../services/ppp-management.service';
import { GenieAcsProvisioningService } from '../../genieacs/services/genieacs-provisioning.service';

describe('NetworkContractPlanChangedListener', () => {
  let listener: NetworkContractPlanChangedListener;
  let provisioningService: any;
  let pppManagementService: any;
  let mockGenieAcsProvisioning: any;

  beforeEach(async () => {
    provisioningService = {
      syncProfileForContract: jest.fn().mockResolvedValue({ id: 'access-1', nodeId: 'node-1', username: 'user1' }),
    };
    pppManagementService = {
      disconnectAccessSession: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    mockGenieAcsProvisioning = {
      changePlan: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworkContractPlanChangedListener,
        { provide: NetworkProvisioningService, useValue: provisioningService },
        { provide: PppManagementService, useValue: pppManagementService },
        { provide: GenieAcsProvisioningService, useValue: mockGenieAcsProvisioning },
      ],
    }).compile();

    listener = module.get<NetworkContractPlanChangedListener>(NetworkContractPlanChangedListener);
  });

  it('debe estar definido', () => {
    expect(listener).toBeDefined();
  });

  it('sincroniza el perfil de red del contrato y actualiza plan en GenieACS al recibir CONTRACT_PLAN_CHANGED', async () => {
    const event: ContractPlanChangedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-000123',
      oldPlanId: 'plan-50',
      newPlanId: 'plan-100',
      occurredOn: new Date(),
    };

    await listener.handleContractPlanChanged(event);

    expect(provisioningService.syncProfileForContract).toHaveBeenCalledWith('contract-1');
    expect(mockGenieAcsProvisioning.changePlan).toHaveBeenCalledWith('contract-1', 'plan-50', 'plan-100');
  });

  it('no propaga el error si falla la sincronización del perfil o GenieACS', async () => {
    provisioningService.syncProfileForContract.mockRejectedValueOnce(new Error('DB down'));
    mockGenieAcsProvisioning.changePlan.mockRejectedValueOnce(new Error('NBI down'));
    const event: ContractPlanChangedEvent = {
      contractId: 'contract-1',
      clientId: 'client-1',
      contractNumber: 'CTR-000123',
      oldPlanId: 'plan-50',
      newPlanId: 'plan-100',
      occurredOn: new Date(),
    };

    await expect(listener.handleContractPlanChanged(event)).resolves.not.toThrow();
  });
});
