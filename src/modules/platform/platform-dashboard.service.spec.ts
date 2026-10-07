import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlatformDashboardService } from './platform-dashboard.service';
import { TenantEntity } from './entities/tenant.entity';
import { SupportAccessSessionEntity } from './entities/support-access-session.entity';
import { SaasPlanEntity } from './entities/saas-plan.entity';
import { SaasSubscriptionsService } from './saas-subscriptions.service';

describe('PlatformDashboardService', () => {
  let service: PlatformDashboardService;
  let tenantRepo: any;
  let sessionRepo: any;
  let planRepo: any;
  let subsService: any;

  beforeEach(async () => {
    tenantRepo = {
      count: jest.fn().mockImplementation(({ where } = {}) => {
        if (!where) return Promise.resolve(10);
        if (where.status === 'ACTIVE') return Promise.resolve(7);
        if (where.status === 'TRIAL') return Promise.resolve(2);
        if (where.status === 'SUSPENDED') return Promise.resolve(1);
        if (where.status === 'CANCELLED') return Promise.resolve(0);
        if (where.createdAt) return Promise.resolve(3); // Altas del mes
        return Promise.resolve(0);
      }),
    };

    sessionRepo = {
      count: jest.fn().mockResolvedValue(1),
    };

    planRepo = {
      count: jest.fn().mockResolvedValue(4),
    };

    subsService = {
      getMrrReport: jest.fn().mockResolvedValue({
        mrr: 1250,
        arr: 15000,
        activeCount: 7,
        breakdownByPlan: [{ planName: 'Pro', count: 5, totalMonthly: 1000 }],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformDashboardService,
        { provide: getRepositoryToken(TenantEntity, 'platform'), useValue: tenantRepo },
        { provide: getRepositoryToken(SupportAccessSessionEntity, 'platform'), useValue: sessionRepo },
        { provide: getRepositoryToken(SaasPlanEntity, 'platform'), useValue: planRepo },
        { provide: SaasSubscriptionsService, useValue: subsService },
      ],
    }).compile();

    service = module.get<PlatformDashboardService>(PlatformDashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMetrics', () => {
    it('aggregates tenants, financial, support and plan metrics', async () => {
      const metrics = await service.getMetrics();

      expect(metrics.tenants.total).toBe(10);
      expect(metrics.tenants.active).toBe(7);
      expect(metrics.tenants.trial).toBe(2);
      expect(metrics.tenants.suspended).toBe(1);
      expect(metrics.tenants.newThisMonth).toBe(3);

      expect(metrics.financials.mrr).toBe(1250);
      expect(metrics.financials.arr).toBe(15000);
      expect(metrics.support.activeSessions).toBe(1);
      expect(metrics.plans.total).toBe(4);
    });
  });

  describe('getTrends', () => {
    it('returns monthly trends for specified number of months', async () => {
      const trends = await service.getTrends(6);

      expect(trends).toHaveLength(6);
      expect(trends[0]).toHaveProperty('month');
      expect(trends[0]).toHaveProperty('mrrEstimate');
      expect(trends[0]).toHaveProperty('newTenants');
    });
  });
});
