import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SaasSubscriptionsService } from './saas-subscriptions.service';
import { SaasSubscriptionEntity } from './entities/saas-subscription.entity';
import { SaasSubscriptionStatus } from './enums/saas-subscription-status.enum';
import { TenantEntity } from './entities/tenant.entity';
import { SaasPlanEntity } from './entities/saas-plan.entity';
import { PlatformAuditService } from './platform-audit.service';

describe('SaasSubscriptionsService', () => {
  let service: SaasSubscriptionsService;
  let subRepo: any;
  let tenantRepo: any;
  let planRepo: any;
  let auditService: any;

  const mockSubs = [
    {
      id: 'sub-1',
      tenantId: 'tenant-1',
      planId: 'plan-1',
      status: SaasSubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 86400000 * 20),
      plan: { id: 'plan-1', name: 'Plan Básico', monthlyPrice: 50 },
      tenant: { id: 'tenant-1', name: 'ISP 1' },
    },
    {
      id: 'sub-2',
      tenantId: 'tenant-2',
      planId: 'plan-2',
      status: SaasSubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(Date.now() + 86400000 * 15),
      plan: { id: 'plan-2', name: 'Plan Pro', monthlyPrice: 150 },
      tenant: { id: 'tenant-2', name: 'ISP 2' },
    },
    {
      id: 'sub-3',
      tenantId: 'tenant-3',
      planId: 'plan-2',
      status: SaasSubscriptionStatus.TRIALING,
      currentPeriodEnd: new Date(Date.now() + 86400000 * 7),
      plan: { id: 'plan-2', name: 'Plan Pro', monthlyPrice: 150 },
      tenant: { id: 'tenant-3', name: 'ISP 3' },
    },
    {
      id: 'sub-4',
      tenantId: 'tenant-4',
      planId: 'plan-1',
      status: SaasSubscriptionStatus.CANCELED,
      currentPeriodEnd: new Date(Date.now() - 86400000 * 10),
      plan: { id: 'plan-1', name: 'Plan Básico', monthlyPrice: 50 },
      tenant: { id: 'tenant-4', name: 'ISP 4' },
    },
  ];

  beforeEach(async () => {
    subRepo = {
      find: jest.fn().mockResolvedValue(mockSubs),
      findAndCount: jest.fn().mockResolvedValue([mockSubs.slice(0, 2), 4]),
      findOne: jest.fn().mockImplementation(({ where }) => {
        const found = mockSubs.find((s) => s.id === where.id || s.tenantId === where.tenantId);
        return Promise.resolve(found ? { ...found } : null);
      }),
      save: jest.fn().mockImplementation((sub) => Promise.resolve({ ...sub })),
      create: jest.fn().mockImplementation((dto) => ({ id: 'new-sub', ...dto })),
    };

    tenantRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'tenant-1', name: 'ISP 1', planId: 'plan-1' }]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    planRepo = {
      findOne: jest.fn().mockImplementation(({ where }) => {
        if (where.id === 'plan-enterprise') {
          return Promise.resolve({ id: 'plan-enterprise', name: 'Plan Enterprise', monthlyPrice: 299 });
        }
        if (where.id === 'plan-1') {
          return Promise.resolve({ id: 'plan-1', name: 'Plan Básico', monthlyPrice: 50 });
        }
        return Promise.resolve(null);
      }),
    };

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaasSubscriptionsService,
        { provide: getRepositoryToken(SaasSubscriptionEntity, 'platform'), useValue: subRepo },
        { provide: getRepositoryToken(TenantEntity, 'platform'), useValue: tenantRepo },
        { provide: getRepositoryToken(SaasPlanEntity, 'platform'), useValue: planRepo },
        { provide: PlatformAuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<SaasSubscriptionsService>(SaasSubscriptionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns all subscriptions with relations', async () => {
      const result = await service.findAll();
      expect(result).toHaveLength(4);
      expect(subRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ relations: ['tenant', 'plan'] }),
      );
    });

    it('supports pagination with limit and page parameters', async () => {
      const result = (await service.findAll({ limit: 2, page: 1 })) as {
        items: any[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(4);
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(0);
      expect(subRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 2,
          skip: 0,
          relations: ['tenant', 'plan'],
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns a subscription by id', async () => {
      const sub = await service.findOne('sub-1');
      expect(sub).toBeDefined();
      expect(sub.id).toBe('sub-1');
    });

    it('throws NotFoundException when subscription does not exist', async () => {
      await expect(service.findOne('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMrrReport', () => {
    it('accurately calculates MRR and ARR from active subscriptions', async () => {
      const report = await service.getMrrReport();

      // sub-1 (50) + sub-2 (150) = 200 MRR
      expect(report.mrr).toBe(200);
      expect(report.arr).toBe(2400); // 200 * 12
      expect(report.activeCount).toBe(2);
      expect(report.trialingCount).toBe(1);
      expect(report.cancelledCount).toBe(1);
      expect(report.totalSubscriptions).toBe(4);
      expect(report.breakdownByPlan).toHaveLength(2);
    });
  });

  describe('changePlan', () => {
    it('changes plan, syncs tenant and logs audit event', async () => {
      const result = await service.changePlan('sub-1', {
        planId: 'plan-enterprise',
        reason: 'Upgrade comercial',
      }, 'admin-1', '127.0.0.1');

      expect(subRepo.save).toHaveBeenCalled();
      expect(tenantRepo.update).toHaveBeenCalledWith('tenant-1', { planId: 'plan-enterprise' });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SAAS_SUBSCRIPTION_PLAN_CHANGED',
          platformUserId: 'admin-1',
        }),
      );
    });

    it('throws NotFoundException if plan does not exist', async () => {
      await expect(
        service.changePlan('sub-1', { planId: 'non-existent-plan' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('updates status and logs audit event', async () => {
      await service.updateStatus('sub-1', {
        status: SaasSubscriptionStatus.PAST_DUE,
        reason: 'Falta de pago reportada',
      }, 'admin-1');

      expect(subRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SAAS_SUBSCRIPTION_STATUS_CHANGED',
        }),
      );
    });
  });

  describe('recordManualPayment', () => {
    it('extends period end, activates status and records audit event', async () => {
      await service.recordManualPayment('sub-1', {
        monthsToAdd: 1,
        paymentReference: 'TRF-98212',
        amountPaid: 50,
        notes: 'Pago verificado Banco BHD',
      }, 'admin-1');

      expect(subRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SAAS_SUBSCRIPTION_PAYMENT_RECORDED',
        }),
      );
    });
  });

  describe('extendTrial', () => {
    it('extends trial period and sets status to TRIALING', async () => {
      await service.extendTrial('sub-3', {
        daysToAdd: 14,
        reason: 'Prórroga solicitada por ISP',
      }, 'admin-1');

      expect(subRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SAAS_SUBSCRIPTION_TRIAL_EXTENDED',
        }),
      );
    });
  });

  describe('syncMissingSubscriptions', () => {
    it('creates missing subscriptions for tenants without subscription', async () => {
      tenantRepo.find.mockResolvedValue([
        { id: 'tenant-orphan', name: 'Orphan ISP', planId: 'plan-1', status: 'ACTIVE' },
      ]);
      subRepo.findOne.mockResolvedValue(null);

      const res = await service.syncMissingSubscriptions();
      expect(res.syncedCount).toBe(1);
      expect(subRepo.save).toHaveBeenCalled();
    });
  });
});
