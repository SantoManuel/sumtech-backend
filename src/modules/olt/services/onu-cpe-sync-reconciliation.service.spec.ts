import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OnuCpeSyncReconciliationService } from './onu-cpe-sync-reconciliation.service';
import { OnuEntity } from '../entities/onu.entity';
import { OnuManagementService } from './onu-management.service';
import { GENIEACS_CLIENT } from '../../genieacs/genieacs-client-factory';
import { TenantIteratorService } from '../../../common/tenancy/tenant-iterator.service';

const tenantIteratorMock = {
  runForEachActiveTenant: jest.fn((_label: string, fn: (t: any) => Promise<void>) => fn({ slug: 'tenant-test' })),
};

describe('OnuCpeSyncReconciliationService', () => {
  let service: OnuCpeSyncReconciliationService;
  let onuRepo: any;
  let onuManagementService: any;
  let client: any;

  const makeOnu = (overrides: Partial<OnuEntity> = {}): OnuEntity =>
    ({
      id: 'onu-1',
      serialNumber: 'CMDCDD4D131E',
      status: 'ACTIVE',
      olt: { name: 'OLT_Tabara_Abajo', vendor: 'ZTE' },
      serviceConfig: { managementMethod: 'TR069', cpeConfigStatus: 'PENDING' },
      ...overrides,
    }) as unknown as OnuEntity;

  beforeEach(async () => {
    onuRepo = { find: jest.fn().mockResolvedValue([]) };
    onuManagementService = { pushCpeConfiguration: jest.fn().mockResolvedValue({ cpeConfigured: true }) };
    client = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnuCpeSyncReconciliationService,
        { provide: getRepositoryToken(OnuEntity), useValue: onuRepo },
        { provide: OnuManagementService, useValue: onuManagementService },
        { provide: GENIEACS_CLIENT, useValue: client },
        { provide: TenantIteratorService, useValue: tenantIteratorMock },
      ],
    }).compile();

    service = module.get<OnuCpeSyncReconciliationService>(OnuCpeSyncReconciliationService);
  });

  it('no hace nada si GenieACS no está configurado (cliente null)', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnuCpeSyncReconciliationService,
        { provide: getRepositoryToken(OnuEntity), useValue: onuRepo },
        { provide: OnuManagementService, useValue: onuManagementService },
        { provide: GENIEACS_CLIENT, useValue: null },
        { provide: TenantIteratorService, useValue: tenantIteratorMock },
      ],
    }).compile();
    const unconfigured = module.get<OnuCpeSyncReconciliationService>(OnuCpeSyncReconciliationService);

    const result = await unconfigured.retryPendingCpeConfig();

    expect(result).toEqual({ checked: 0, succeeded: 0, failed: 0 });
    expect(onuRepo.find).not.toHaveBeenCalled();
  });

  it('solo reintenta ONUs ACTIVE + TR-069 + cpeConfigStatus distinto de APPLIED', async () => {
    onuRepo.find.mockResolvedValue([
      makeOnu({ id: 'onu-1', serviceConfig: { managementMethod: 'TR069', cpeConfigStatus: 'PENDING' } as any }),
      makeOnu({ id: 'onu-2', serviceConfig: { managementMethod: 'TR069', cpeConfigStatus: 'ERROR' } as any }),
      makeOnu({ id: 'onu-3', serviceConfig: { managementMethod: 'TR069', cpeConfigStatus: 'APPLIED' } as any }),
      makeOnu({ id: 'onu-4', serviceConfig: { managementMethod: 'OMCI', cpeConfigStatus: 'PENDING' } as any }),
    ]);

    const result = await service.retryPendingCpeConfig();

    expect(result.checked).toBe(2);
    expect(onuManagementService.pushCpeConfiguration).toHaveBeenCalledTimes(2);
    const calledOnuIds = onuManagementService.pushCpeConfiguration.mock.calls.map((c: any[]) => c[0].id);
    expect(calledOnuIds).toEqual(['onu-1', 'onu-2']);
  });

  it('llama a pushCpeConfiguration con la ONU, su serviceConfig, su olt y sin overrides de WAN estática (limitación conocida, ver comentario en el servicio)', async () => {
    onuRepo.find.mockResolvedValue([makeOnu()]);

    await service.retryPendingCpeConfig();

    expect(onuManagementService.pushCpeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'onu-1' }),
      expect.objectContaining({ managementMethod: 'TR069' }),
      expect.objectContaining({ name: 'OLT_Tabara_Abajo' }),
      {},
      expect.objectContaining({ operation: 'onuCpeSync.retry' }),
    );
  });

  it('cuenta succeeded/failed según lo que devuelva pushCpeConfiguration', async () => {
    onuRepo.find.mockResolvedValue([
      makeOnu({ id: 'onu-1' }),
      makeOnu({ id: 'onu-2' }),
    ]);
    onuManagementService.pushCpeConfiguration
      .mockResolvedValueOnce({ cpeConfigured: true })
      .mockResolvedValueOnce({ cpeConfigured: false, cpeConfigWarning: 'todavía no reporta' });

    const result = await service.retryPendingCpeConfig();

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('un fallo inesperado (ej. error de BD) en una ONU no aborta el resto del ciclo', async () => {
    onuRepo.find.mockResolvedValue([
      makeOnu({ id: 'onu-1' }),
      makeOnu({ id: 'onu-2' }),
    ]);
    onuManagementService.pushCpeConfiguration
      .mockRejectedValueOnce(new Error('timeout de base de datos'))
      .mockResolvedValueOnce({ cpeConfigured: true });

    const result = await service.retryPendingCpeConfig();

    expect(result.checked).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it('no hace nada si no hay ninguna ONU pendiente', async () => {
    onuRepo.find.mockResolvedValue([]);

    const result = await service.retryPendingCpeConfig();

    expect(result).toEqual({ checked: 0, succeeded: 0, failed: 0 });
    expect(onuManagementService.pushCpeConfiguration).not.toHaveBeenCalled();
  });
});
