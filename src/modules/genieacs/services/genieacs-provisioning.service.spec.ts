import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GenieAcsProvisioningService } from './genieacs-provisioning.service';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsDeviceResolverService } from '../genieacs-device-resolver.service';
import { GenieAcsDeviceEntity } from '../entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from '../entities/genieacs-audit-log.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';

describe('GenieAcsProvisioningService', () => {
  let service: GenieAcsProvisioningService;
  let mockClient: any;
  let mockResolver: any;
  let mockDeviceRepo: any;
  let mockAuditRepo: any;
  let mockContractRepo: any;
  let mockPlanRepo: any;

  beforeEach(async () => {
    mockClient = {
      setDeviceTag: jest.fn().mockResolvedValue(undefined),
      deleteDeviceTag: jest.fn().mockResolvedValue(undefined),
      refreshObject: jest.fn().mockResolvedValue(undefined),
      getDeviceStatus: jest.fn().mockResolvedValue({ tags: ['PLAN:plan-100', 'CLI:client-1'] }),
    };

    mockResolver = {
      resolveForContract: jest.fn().mockResolvedValue({
        id: 'device-1',
        contractId: 'contract-uuid-1',
        genieacsDeviceId: '00259E-HG8546M-485754437C8E7143',
      }),
    };

    mockDeviceRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((d) => Promise.resolve(d)),
    };

    mockAuditRepo = {
      save: jest.fn().mockImplementation((a) => Promise.resolve({ id: 'audit-1', ...a })),
    };

    mockContractRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'contract-uuid-1',
        clientId: 'client-uuid-1',
        planId: 'plan-uuid-1',
        plan: { id: 'plan-uuid-1', name: 'Plan 100M', speedMbps: 100 },
      }),
    };

    mockPlanRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenieAcsProvisioningService,
        {
          provide: GENIEACS_CLIENT,
          useValue: mockClient,
        },
        {
          provide: GenieAcsDeviceResolverService,
          useValue: mockResolver,
        },
        {
          provide: getRepositoryToken(GenieAcsDeviceEntity),
          useValue: mockDeviceRepo,
        },
        {
          provide: getRepositoryToken(GenieAcsAuditLogEntity),
          useValue: mockAuditRepo,
        },
        {
          provide: getRepositoryToken(ContractEntity),
          useValue: mockContractRepo,
        },
        {
          provide: getRepositoryToken(PlanEntity),
          useValue: mockPlanRepo,
        },
      ],
    }).compile();

    service = module.get<GenieAcsProvisioningService>(GenieAcsProvisioningService);
  });

  describe('assignCustomerPlan (Caso 1)', () => {
    it('debe asignar tags CLI y PLAN y refrescar el objeto en GenieACS', async () => {
      const result = await service.assignCustomerPlan('contract-uuid-1', 'client-uuid-1', 'plan-100');

      expect(result.success).toBe(true);
      expect(result.deviceId).toBe('00259E-HG8546M-485754437C8E7143');
      expect(mockClient.setDeviceTag).toHaveBeenCalledWith(
        '00259E-HG8546M-485754437C8E7143',
        'CLI:client-uuid-1',
      );
      expect(mockClient.setDeviceTag).toHaveBeenCalledWith(
        '00259E-HG8546M-485754437C8E7143',
        'PLAN:plan-100',
      );
      expect(mockClient.refreshObject).toHaveBeenCalledWith('00259E-HG8546M-485754437C8E7143');
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TR069_PARAMETER_CHANGE',
          actor: 'ERP',
          result: 'OK',
          newValue: 'CLI:client-uuid-1, PLAN:plan-100',
        }),
      );
    });

    it('devuelve success=false si el contrato no tiene CPE vinculado', async () => {
      mockResolver.resolveForContract.mockResolvedValueOnce(null);

      const result = await service.assignCustomerPlan('contract-without-cpe');

      expect(result.success).toBe(false);
      expect(result.reason).toBe('NO_DEVICE_RESOLVED');
      expect(mockClient.setDeviceTag).not.toHaveBeenCalled();
    });
  });

  describe('changePlan (Caso 2)', () => {
    it('elimina el tag de plan antiguo, asigna el nuevo y refresca el equipo', async () => {
      const result = await service.changePlan('contract-uuid-1', 'plan-100', 'plan-300');

      expect(result.success).toBe(true);
      expect(mockClient.deleteDeviceTag).toHaveBeenCalledWith(
        '00259E-HG8546M-485754437C8E7143',
        'PLAN:plan-100',
      );
      expect(mockClient.setDeviceTag).toHaveBeenCalledWith(
        '00259E-HG8546M-485754437C8E7143',
        'PLAN:plan-300',
      );
      expect(mockClient.refreshObject).toHaveBeenCalledWith('00259E-HG8546M-485754437C8E7143');
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TR069_PARAMETER_CHANGE',
          parameterPath: 'Tags.PLAN',
          oldValue: 'PLAN:plan-100',
          newValue: 'PLAN:plan-300',
        }),
      );
    });
  });

  describe('suspendService (Caso 3)', () => {
    it('asigna el tag STATUS:SUSPENDIDO y refresca el equipo', async () => {
      const result = await service.suspendService('contract-uuid-1');

      expect(result.success).toBe(true);
      expect(mockClient.setDeviceTag).toHaveBeenCalledWith(
        '00259E-HG8546M-485754437C8E7143',
        'STATUS:SUSPENDIDO',
      );
      expect(mockClient.refreshObject).toHaveBeenCalledWith('00259E-HG8546M-485754437C8E7143');
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TR069_PARAMETER_CHANGE',
          parameterPath: 'Tags.STATUS',
          newValue: 'STATUS:SUSPENDIDO',
        }),
      );
    });
  });

  describe('reactivateService (Caso 3b)', () => {
    it('elimina el tag STATUS:SUSPENDIDO y refresca el equipo', async () => {
      const result = await service.reactivateService('contract-uuid-1');

      expect(result.success).toBe(true);
      expect(mockClient.deleteDeviceTag).toHaveBeenCalledWith(
        '00259E-HG8546M-485754437C8E7143',
        'STATUS:SUSPENDIDO',
      );
      expect(mockClient.refreshObject).toHaveBeenCalledWith('00259E-HG8546M-485754437C8E7143');
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TR069_PARAMETER_CHANGE',
          parameterPath: 'Tags.STATUS',
          oldValue: 'STATUS:SUSPENDIDO',
        }),
      );
    });
  });
});

