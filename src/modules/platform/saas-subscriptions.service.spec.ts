import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SaasSubscriptionsService } from './saas-subscriptions.service';
import { SaasSubscriptionEntity } from './entities/saas-subscription.entity';
import { SaasSubscriptionStatus } from './enums/saas-subscription-status.enum';

describe('SaasSubscriptionsService', () => {
  let service: SaasSubscriptionsService;
  let subRepo: any;

  const mockSubs = [
    {
      id: 'sub-1',
      status: SaasSubscriptionStatus.ACTIVE,
      plan: { name: 'Plan Básico', monthlyPrice: 50 },
      tenant: { name: 'ISP 1' },
    },
    {
      id: 'sub-2',
      status: SaasSubscriptionStatus.ACTIVE,
      plan: { name: 'Plan Pro', monthlyPrice: 150 },
      tenant: { name: 'ISP 2' },
    },
    {
      id: 'sub-3',
      status: SaasSubscriptionStatus.TRIALING,
      plan: { name: 'Plan Pro', monthlyPrice: 150 },
      tenant: { name: 'ISP 3' },
    },
    {
      id: 'sub-4',
      status: SaasSubscriptionStatus.CANCELED,
      plan: { name: 'Plan Básico', monthlyPrice: 50 },
      tenant: { name: 'ISP 4' },
    },
  ];

  beforeEach(async () => {
    subRepo = {
      find: jest.fn().mockResolvedValue(mockSubs),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaasSubscriptionsService,
        { provide: getRepositoryToken(SaasSubscriptionEntity, 'platform'), useValue: subRepo },
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
});
