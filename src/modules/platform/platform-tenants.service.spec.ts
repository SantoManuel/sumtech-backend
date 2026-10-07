import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PlatformTenantsService } from './platform-tenants.service';
import { TenantEntity } from './entities/tenant.entity';
import { TenantStatus } from './enums/tenant-status.enum';
import { PlatformAuditService } from './platform-audit.service';
import { TenantConnectionManagerService } from '../../common/tenancy/tenant-connection-manager.service';

describe('PlatformTenantsService', () => {
  let service: PlatformTenantsService;
  let tenantRepo: any;
  let auditService: any;
  let connectionManager: any;

  const mockTenant: Partial<TenantEntity> = {
    id: 'tenant-uuid-1',
    name: 'ISP TeleAzua',
    slug: 'teleazua',
    status: TenantStatus.ACTIVE,
    dbName: 'tenant_teleazua',
    rnc: '131-99887-1',
  };

  beforeEach(async () => {
    tenantRepo = {
      find: jest.fn().mockResolvedValue([mockTenant]),
      findAndCount: jest.fn().mockResolvedValue([[mockTenant], 1]),
      findOne: jest.fn().mockImplementation(({ where }) => {
        if (where.id === 'tenant-uuid-1') return Promise.resolve({ ...mockTenant });
        return Promise.resolve(null);
      }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };

    auditService = {
      log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    connectionManager = {
      getDataSourceForTenant: jest.fn().mockResolvedValue({
        isInitialized: true,
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('pg_database_size')) {
            return Promise.resolve([{ size_bytes: '25165824', size_pretty: '24 MB' }]);
          }
          if (sql.includes('information_schema.tables')) {
            return Promise.resolve([{ exists: 1 }]);
          }
          if (sql.includes('FROM "sec"."schema_migrations"') && sql.includes('LIMIT 1')) {
            return Promise.resolve([
              {
                filename: '054_rename_tenant_configs_to_company_profile.sql',
                applied_at: new Date('2026-09-24T12:00:00Z'),
              },
            ]);
          }
          if (sql.includes('COUNT(*)::int')) {
            return Promise.resolve([{ count: '54' }]);
          }
          return Promise.resolve([]);
        }),
        getRepository: jest.fn().mockReturnValue({
          count: jest.fn().mockResolvedValue(10),
        }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformTenantsService,
        { provide: getRepositoryToken(TenantEntity, 'platform'), useValue: tenantRepo },
        { provide: PlatformAuditService, useValue: auditService },
        { provide: TenantConnectionManagerService, useValue: connectionManager },
      ],
    }).compile();

    service = module.get<PlatformTenantsService>(PlatformTenantsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns all tenants when no filters are applied', async () => {
      const result = await service.findAll({});
      expect(result).toHaveLength(1);
      expect(tenantRepo.find).toHaveBeenCalled();
    });

    it('filters by status when provided', async () => {
      await service.findAll({ status: TenantStatus.ACTIVE });
      expect(tenantRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: TenantStatus.ACTIVE }),
        }),
      );
    });

    it('searches by name, slug or rnc when search is provided', async () => {
      await service.findAll({ search: 'tele' });
      expect(tenantRepo.find).toHaveBeenCalled();
    });

    it('returns paginated response when limit is provided', async () => {
      const result = (await service.findAll({ limit: 10, page: 1 })) as {
        items: any[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
      expect(tenantRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 0 }),
      );
    });
  });

  describe('update', () => {
    it('updates tenant name and rnc and logs audit event', async () => {
      const result = await service.update(
        'tenant-uuid-1',
        { name: 'ISP TeleAzua Actualizado', rnc: '131-00000-0' },
        'admin-1',
        '127.0.0.1',
      );

      expect(tenantRepo.save).toHaveBeenCalled();
      expect(result.name).toBe('ISP TeleAzua Actualizado');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TENANT_UPDATED',
          entity: 'Tenant',
          entityId: 'tenant-uuid-1',
        }),
      );
    });

    it('throws NotFoundException if tenant does not exist', async () => {
      await expect(service.update('invalid-id', { name: 'Fail' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOne', () => {
    it('returns tenant with stats if exists', async () => {
      const result = await service.findOne('tenant-uuid-1');
      expect(result.id).toBe('tenant-uuid-1');
      expect(result.stats).toBeDefined();
      expect(result.stats.userCount).toBe(10);
      expect(result.stats.clientCount).toBe(10);
    });

    it('throws NotFoundException if tenant does not exist', async () => {
      await expect(service.findOne('invalid-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('suspend', () => {
    it('suspends an active tenant and logs audit', async () => {
      const result = await service.suspend('tenant-uuid-1', { reason: 'Falta de pago' }, 'admin-1', '127.0.0.1');
      expect(result.status).toBe(TenantStatus.SUSPENDED);
      expect(tenantRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TENANT_SUSPENDED',
          entity: 'Tenant',
          entityId: 'tenant-uuid-1',
          platformUserId: 'admin-1',
        }),
      );
    });

    it('returns immediately if already suspended', async () => {
      tenantRepo.findOne.mockResolvedValueOnce({ ...mockTenant, status: TenantStatus.SUSPENDED });
      const result = await service.suspend('tenant-uuid-1');
      expect(result.status).toBe(TenantStatus.SUSPENDED);
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if tenant not found', async () => {
      await expect(service.suspend('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reactivate', () => {
    it('reactivates a suspended tenant and logs audit', async () => {
      tenantRepo.findOne.mockResolvedValueOnce({ ...mockTenant, status: TenantStatus.SUSPENDED });
      const result = await service.reactivate('tenant-uuid-1', 'admin-1', '127.0.0.1');
      expect(result.status).toBe(TenantStatus.ACTIVE);
      expect(tenantRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TENANT_REACTIVATED',
          entity: 'Tenant',
          entityId: 'tenant-uuid-1',
        }),
      );
    });

    it('throws BadRequestException if tenant is CANCELLED', async () => {
      tenantRepo.findOne.mockResolvedValueOnce({ ...mockTenant, status: TenantStatus.CANCELLED });
      await expect(service.reactivate('tenant-uuid-1')).rejects.toThrow(BadRequestException);
    });

    it('activates a TRIAL tenant and logs TENANT_ACTIVATED_FROM_TRIAL instead of TENANT_REACTIVATED', async () => {
      tenantRepo.findOne.mockResolvedValueOnce({ ...mockTenant, status: TenantStatus.TRIAL });
      const result = await service.reactivate('tenant-uuid-1', 'admin-1', '127.0.0.1');
      expect(result.status).toBe(TenantStatus.ACTIVE);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TENANT_ACTIVATED_FROM_TRIAL',
          entity: 'Tenant',
          entityId: 'tenant-uuid-1',
        }),
      );
    });
  });

  describe('getTenantHealth', () => {
    it('returns operational health metrics when database is healthy', async () => {
      const health = await service.getTenantHealth('tenant-uuid-1');
      expect(health.status).toBe('HEALTHY');
      expect(health.dbConnected).toBe(true);
      expect(health.dbSizeBytes).toBe(25165824);
      expect(health.dbSizePretty).toBe('24 MB');
      expect(health.lastMigration?.filename).toBe('054_rename_tenant_configs_to_company_profile.sql');
      expect(health.totalMigrationsApplied).toBe(54);
      expect(health.userCount).toBe(10);
      expect(health.clientCount).toBe(10);
    });

    it('returns UNREACHABLE with safe defaults when DB connection fails', async () => {
      connectionManager.getDataSourceForTenant.mockRejectedValueOnce(new Error('Connection timed out'));
      const health = await service.getTenantHealth('tenant-uuid-1');
      expect(health.status).toBe('UNREACHABLE');
      expect(health.dbConnected).toBe(false);
      expect(health.dbSizeBytes).toBe(0);
      expect(health.dbSizePretty).toBe('0 B');
      expect(health.errorMessage).toBe('Connection timed out');
    });

    it('throws NotFoundException if tenant ID does not exist', async () => {
      await expect(service.getTenantHealth('invalid-uuid')).rejects.toThrow(NotFoundException);
    });
  });
});
