import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SaasPlansService } from './saas-plans.service';
import { SaasPlanEntity } from './entities/saas-plan.entity';
import { SaasSubscriptionEntity } from './entities/saas-subscription.entity';
import { PlatformAuditService } from './platform-audit.service';

describe('SaasPlansService', () => {
  let service: SaasPlansService;
  let planRepo: any;
  let subRepo: any;
  let auditService: any;

  const mockPlan: Partial<SaasPlanEntity> = {
    id: 'plan-1',
    name: 'Plan ISP Pro',
    monthlyPrice: 150,
    maxUsers: 10,
    maxClients: 500,
    features: { invoicing: true },
    isActive: true,
  };

  beforeEach(async () => {
    planRepo = {
      find: jest.fn().mockResolvedValue([mockPlan]),
      findOne: jest.fn().mockImplementation(({ where }) => {
        if (where.id === 'plan-1') return Promise.resolve({ ...mockPlan });
        if (where.name === 'Duplicado') return Promise.resolve({ ...mockPlan, name: 'Duplicado' });
        return Promise.resolve(null);
      }),
      create: jest.fn().mockImplementation((p) => ({ ...p, id: 'plan-created' })),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    subRepo = {
      count: jest.fn().mockResolvedValue(0),
    };

    auditService = {
      log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaasPlansService,
        { provide: getRepositoryToken(SaasPlanEntity, 'platform'), useValue: planRepo },
        { provide: getRepositoryToken(SaasSubscriptionEntity, 'platform'), useValue: subRepo },
        { provide: PlatformAuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<SaasPlansService>(SaasPlansService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns all plans', async () => {
      const plans = await service.findAll();
      expect(plans).toHaveLength(1);
      expect(planRepo.find).toHaveBeenCalled();
    });

    it('filters only active plans when requested', async () => {
      await service.findAll(true);
      expect(planRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });

  describe('create', () => {
    it('creates a new SaaS plan successfully', async () => {
      const result = await service.create({
        name: 'Nuevo Plan',
        monthlyPrice: 200,
        maxUsers: 20,
        maxClients: 1000,
      });

      expect(result.name).toBe('Nuevo Plan');
      expect(result.monthlyPrice).toBe(200);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SAAS_PLAN_CREATED' }),
      );
    });

    it('throws BadRequestException if name already exists', async () => {
      await expect(
        service.create({ name: 'Duplicado', monthlyPrice: 100 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates plan fields and logs audit', async () => {
      const result = await service.update('plan-1', {
        monthlyPrice: 175,
        maxClients: 600,
      });

      expect(result.monthlyPrice).toBe(175);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SAAS_PLAN_UPDATED' }),
      );
    });

    it('throws NotFoundException if plan does not exist', async () => {
      await expect(
        service.update('non-existent', { monthlyPrice: 100 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes plan if no active subscriptions', async () => {
      subRepo.count.mockResolvedValueOnce(0);
      const res = await service.remove('plan-1');
      expect(planRepo.delete).toHaveBeenCalledWith('plan-1');
      expect(res.message).toContain('eliminado correctamente');
    });

    it('soft-deletes plan (isActive: false) if it has subscriptions', async () => {
      subRepo.count.mockResolvedValueOnce(3);
      const res = await service.remove('plan-1');
      expect(planRepo.delete).not.toHaveBeenCalled();
      expect(planRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
      expect(res.message).toContain('desactivado en lugar de eliminado');
    });
  });
});
