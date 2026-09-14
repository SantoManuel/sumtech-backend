import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlanEntity } from './entities/plan.entity';
import { SystemEvents } from '../../common/enums/system-events.enum';

describe('PlansService', () => {
  let service: PlansService;
  let planRepo: any;
  let queryBuilder: any;
  let eventEmitter: any;

  const makePlan = (overrides: Partial<PlanEntity> = {}): PlanEntity =>
    ({
      id: 'plan-1',
      name: 'Fibra 100',
      serviceType: 'INTERNET',
      speedMbps: 100,
      tvChannelsCount: 0,
      monthlyPrice: 1500,
      itbisRate: 0.18,
      cdtRate: 0.02,
      isFeatured: false,
      isActive: true,
      ...overrides,
    }) as PlanEntity;

  beforeEach(async () => {
    queryBuilder = {
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[makePlan()], 1]),
    };

    planRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id || 'plan-generated', ...entity })),
    };

    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: getRepositoryToken(PlanEntity), useValue: planRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<PlansService>(PlansService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('aplica paginación por defecto (page 1, limit 20) y devuelve la forma paginada estándar', async () => {
      const result = await service.findAll();

      expect(result).toEqual({ data: [makePlan()], total: 1, page: 1, limit: 20, totalPages: 1 });
      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(20);
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('plan.monthlyPrice', 'ASC');
    });

    it('respeta page/limit provistos', async () => {
      await service.findAll({ page: 3, limit: 5 });

      expect(queryBuilder.skip).toHaveBeenCalledWith(10);
      expect(queryBuilder.take).toHaveBeenCalledWith(5);
    });

    it('filtra por isActive cuando activeOnly=true', async () => {
      await service.findAll({}, true);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('plan.isActive = :active', { active: true });
    });

    it('no filtra por isActive cuando activeOnly=false (default)', async () => {
      await service.findAll({});

      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith('plan.isActive = :active', expect.anything());
    });

    it('filtra por nombre cuando se provee search', async () => {
      await service.findAll({ search: 'Fibra' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('plan.name ILIKE :search', { search: '%Fibra%' });
    });

    it('no aplica filtro de search cuando no se provee', async () => {
      await service.findAll({});

      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.anything(),
      );
    });
  });

  describe('findFeatured', () => {
    it('solo devuelve planes destacados y activos, ordenados por precio', async () => {
      planRepo.find.mockResolvedValue([makePlan({ isFeatured: true })]);

      const result = await service.findFeatured();

      expect(result).toHaveLength(1);
      expect(planRepo.find).toHaveBeenCalledWith({
        where: { isFeatured: true, isActive: true },
        order: { monthlyPrice: 'ASC' },
      });
    });
  });

  describe('findById', () => {
    it('lanza NotFoundException si el plan no existe', async () => {
      planRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findById('plan-x')).rejects.toThrow(NotFoundException);
    });

    it('devuelve el plan encontrado (incluye inactivos, sin filtrar isActive)', async () => {
      planRepo.findOneBy.mockResolvedValue(makePlan({ isActive: false }));

      const result = await service.findById('plan-1');
      expect(result.isActive).toBe(false);
    });
  });

  describe('create', () => {
    it('crea el plan forzando isActive=true y aplicando default de itbisRate cuando no se provee', async () => {
      const result = await service.create({
        name: 'Nuevo',
        serviceType: 'INTERNET',
        speedMbps: 200,
        tvChannelsCount: 0,
        monthlyPrice: 2000,
      } as any);

      expect(result.isActive).toBe(true);
      expect(result.itbisRate).toBe(0.18);
    });

    it('respeta itbisRate y cdtRate explícitos al crear', async () => {
      const result = await service.create({
        name: 'Nuevo',
        serviceType: 'INTERNET',
        speedMbps: 200,
        tvChannelsCount: 0,
        monthlyPrice: 2000,
        itbisRate: 0.16,
        cdtRate: 0.05,
      } as any);

      expect(result.itbisRate).toBe(0.16);
      expect(result.cdtRate).toBe(0.05);
    });
  });

  describe('update', () => {
    it('lanza NotFoundException si el plan no existe', async () => {
      planRepo.findOneBy.mockResolvedValue(null);

      await expect(service.update('plan-x', { name: 'X' } as any)).rejects.toThrow(NotFoundException);
    });

    it('mergea únicamente los campos provistos, incluyendo cdtRate e itbisRate', async () => {
      planRepo.findOneBy.mockResolvedValue(makePlan());

      const result = await service.update('plan-1', { cdtRate: 0.03, itbisRate: 0.16 } as any);

      expect(result.cdtRate).toBe(0.03);
      expect(result.itbisRate).toBe(0.16);
      expect(result.name).toBe('Fibra 100');
    });

    it('emite PLAN_SPEED_CHANGED cuando speedMbps cambia', async () => {
      planRepo.findOneBy.mockResolvedValue(makePlan({ speedMbps: 20 }));

      await service.update('plan-1', { speedMbps: 25 } as any);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SystemEvents.PLAN_SPEED_CHANGED,
        expect.objectContaining({ planId: 'plan-1', oldSpeedMbps: 20, newSpeedMbps: 25 }),
      );
    });

    it('no emite PLAN_SPEED_CHANGED si no se envía speedMbps', async () => {
      planRepo.findOneBy.mockResolvedValue(makePlan({ speedMbps: 20 }));

      await service.update('plan-1', { name: 'Renombrado' } as any);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('no emite PLAN_SPEED_CHANGED si speedMbps se envía pero es igual al actual', async () => {
      planRepo.findOneBy.mockResolvedValue(makePlan({ speedMbps: 20 }));

      await service.update('plan-1', { speedMbps: 20 } as any);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('lanza NotFoundException si el plan no existe', async () => {
      planRepo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate('plan-x')).rejects.toThrow(NotFoundException);
    });

    it('pone isActive=false en un plan activo', async () => {
      planRepo.findOneBy.mockResolvedValue(makePlan({ isActive: true }));

      const result = await service.deactivate('plan-1');

      expect(result.isActive).toBe(false);
      expect(planRepo.save).toHaveBeenCalled();
    });

    it('es idempotente: desactivar un plan ya inactivo no falla y no vuelve a guardar', async () => {
      planRepo.findOneBy.mockResolvedValue(makePlan({ isActive: false }));

      const result = await service.deactivate('plan-1');

      expect(result.isActive).toBe(false);
      expect(planRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('reactivate', () => {
    it('pone isActive=true en un plan inactivo', async () => {
      planRepo.findOneBy.mockResolvedValue(makePlan({ isActive: false }));

      const result = await service.reactivate('plan-1');

      expect(result.isActive).toBe(true);
      expect(planRepo.save).toHaveBeenCalled();
    });

    it('es idempotente: reactivar un plan ya activo no falla y no vuelve a guardar', async () => {
      planRepo.findOneBy.mockResolvedValue(makePlan({ isActive: true }));

      const result = await service.reactivate('plan-1');

      expect(result.isActive).toBe(true);
      expect(planRepo.save).not.toHaveBeenCalled();
    });
  });
});
