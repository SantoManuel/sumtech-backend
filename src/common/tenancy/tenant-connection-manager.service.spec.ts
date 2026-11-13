import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TenantConnectionManagerService } from './tenant-connection-manager.service';
import { TenantEntity } from '../../modules/platform/entities/tenant.entity';
import { TenantStatus } from '../../modules/platform/enums/tenant-status.enum';

describe('TenantConnectionManagerService', () => {
  let service: TenantConnectionManagerService;
  let tenantRepo: any;

  beforeEach(async () => {
    tenantRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantConnectionManagerService,
        {
          provide: getRepositoryToken(TenantEntity, 'platform'),
          useValue: tenantRepo,
        },
      ],
    }).compile();

    service = module.get<TenantConnectionManagerService>(TenantConnectionManagerService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe resolver tenant directamente por RNC limpio desde platform.tenants', async () => {
    const mockTenant: Partial<TenantEntity> = {
      id: 'tenant-uuid-1',
      slug: 'teleazua',
      rnc: '131972004',
      status: TenantStatus.ACTIVE,
      dbName: 'tenant_teleazua',
    };

    tenantRepo.findOne.mockResolvedValueOnce(mockTenant);

    const result = await service.resolveTenantByRnc('1-31-97200-4');

    expect(tenantRepo.findOne).toHaveBeenCalledWith({
      where: [{ rnc: '131972004' }, { rnc: '1-31-97200-4' }],
      relations: ['plan'],
    });
    expect(result).toEqual(mockTenant);
  });

  it('debe utilizar fallback auto-recuperable consultando sec.company_profile si platform.tenants no tiene RNC', async () => {
    tenantRepo.findOne.mockResolvedValueOnce(null);
    tenantRepo.createQueryBuilder.mockReturnValueOnce({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValueOnce(null),
    });

    const candidateTenant: Partial<TenantEntity> = {
      id: 'tenant-uuid-teleazua',
      slug: 'teleazua',
      rnc: undefined,
      status: TenantStatus.ACTIVE,
      dbName: 'tenant_teleazua',
    };

    tenantRepo.find.mockResolvedValueOnce([candidateTenant]);

    const mockDataSource = {
      query: jest.fn().mockResolvedValueOnce([{ rnc: '131972004' }]),
    };
    jest.spyOn(service, 'getDataSourceForTenant').mockResolvedValueOnce(mockDataSource as any);

    const result = await service.resolveTenantByRnc('131972004');

    expect(result).toBeDefined();
    expect(result?.slug).toBe('teleazua');
    expect(result?.rnc).toBe('131972004');
    expect(tenantRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'teleazua', rnc: '131972004' }),
    );
  });

  it('debe sincronizar RNC con platform.tenants mediante syncTenantRnc', async () => {
    await service.syncTenantRnc('teleazua', '1-31-97200-4');

    expect(tenantRepo.update).toHaveBeenCalledWith(
      { slug: 'teleazua' },
      { rnc: '131972004' },
    );
  });
});
