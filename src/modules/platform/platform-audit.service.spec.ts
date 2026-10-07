import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuditLogEntity } from './entities/platform-audit-log.entity';

describe('PlatformAuditService', () => {
  let service: PlatformAuditService;
  let auditRepo: any;
  let qb: any;

  const mockLogs = [
    {
      id: 'log-1',
      action: 'TENANT_PROVISIONED',
      entity: 'Tenant',
      entityId: 'tenant-1',
      platformUserId: 'admin-1',
      metadata: { slug: 'netplus' },
      ipAddress: '127.0.0.1',
      createdAt: new Date('2026-10-01T10:00:00Z'),
      platformUser: { email: 'superadmin@sumtech.com' },
    },
    {
      id: 'log-2',
      action: 'SAAS_SUBSCRIPTION_PLAN_CHANGED',
      entity: 'SaasSubscription',
      entityId: 'sub-1',
      platformUserId: 'admin-1',
      metadata: { planId: 'plan-pro' },
      ipAddress: '127.0.0.1',
      createdAt: new Date('2026-10-02T12:00:00Z'),
      platformUser: { email: 'superadmin@sumtech.com' },
    },
  ];

  beforeEach(async () => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([mockLogs, 2]),
    };

    auditRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'new-log', ...dto })),
      save: jest.fn().mockImplementation((record) => Promise.resolve(record)),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformAuditService,
        {
          provide: getRepositoryToken(PlatformAuditLogEntity, 'platform'),
          useValue: auditRepo,
        },
      ],
    }).compile();

    service = module.get<PlatformAuditService>(PlatformAuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('log', () => {
    it('creates and saves an audit log record', async () => {
      const result = await service.log({
        action: 'TEST_ACTION',
        entity: 'TestEntity',
        entityId: 'entity-123',
        platformUserId: 'user-1',
        metadata: { info: 'test' },
        ipAddress: '192.168.1.1',
      });

      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TEST_ACTION',
          entity: 'TestEntity',
          entityId: 'entity-123',
        }),
      );
      expect(auditRepo.save).toHaveBeenCalled();
      expect(result.action).toBe('TEST_ACTION');
    });

    it('handles database errors gracefully without throwing', async () => {
      auditRepo.save.mockRejectedValueOnce(new Error('DB Connection Failed'));

      const result = await service.log({
        action: 'FAIL_ACTION',
      });

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('returns paginated audit logs with metadata', async () => {
      const result = await service.findAll({ limit: 10, page: 1 });

      expect(auditRepo.createQueryBuilder).toHaveBeenCalledWith('log');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('log.platformUser', 'user');
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it('applies search and action filters when provided', async () => {
      await service.findAll({
        search: 'netplus',
        action: 'TENANT_PROVISIONED',
        startDate: '2026-10-01',
        endDate: '2026-10-02',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('log.action ILIKE :search'),
        expect.objectContaining({ search: '%netplus%' }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'log.action ILIKE :action',
        expect.objectContaining({ action: '%TENANT_PROVISIONED%' }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'log.createdAt >= :startDate',
        expect.anything(),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'log.createdAt <= :endDate',
        expect.anything(),
      );
    });
  });
});
