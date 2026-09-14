import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums/role.enum';

describe('PlansController', () => {
  let controller: PlansController;
  let service: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue({ data: [{ id: 'plan-1' }], total: 1, page: 1, limit: 20, totalPages: 1 }),
      findFeatured: jest.fn().mockResolvedValue([{ id: 'plan-1', isFeatured: true }]),
      findById: jest.fn().mockResolvedValue({ id: 'plan-1' }),
      create: jest.fn().mockResolvedValue({ id: 'plan-new' }),
      update: jest.fn().mockResolvedValue({ id: 'plan-1', name: 'Actualizado' }),
      deactivate: jest.fn().mockResolvedValue({ id: 'plan-1', isActive: false }),
      reactivate: jest.fn().mockResolvedValue({ id: 'plan-1', isActive: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlansController],
      providers: [
        { provide: PlansService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<PlansController>(PlansController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('findAll delega en el servicio pasando includeInactive invertido como activeOnly', async () => {
    const result = await controller.findAll({ page: 1, limit: 20, includeInactive: true } as any);
    expect(result.data).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith(
      { page: 1, limit: 20, includeInactive: true },
      false,
    );
  });

  it('findAll pide solo planes activos por defecto cuando no se pide includeInactive', async () => {
    await controller.findAll({ page: 1, limit: 20 } as any);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 }, true);
  });

  it('findFeatured delega en el servicio', async () => {
    const result = await controller.findFeatured();
    expect(result).toEqual([{ id: 'plan-1', isFeatured: true }]);
  });

  it('findById delega en el servicio con el id', async () => {
    await controller.findById('plan-1');
    expect(service.findById).toHaveBeenCalledWith('plan-1');
  });

  it('create delega en el servicio con el DTO', async () => {
    const dto = { name: 'Nuevo Plan', serviceType: 'INTERNET', speedMbps: 100, tvChannelsCount: 0, monthlyPrice: 1000 } as any;
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('update delega en el servicio con id y DTO', async () => {
    await controller.update('plan-1', { name: 'Actualizado' } as any);
    expect(service.update).toHaveBeenCalledWith('plan-1', { name: 'Actualizado' });
  });

  it('deactivate delega en el servicio con el id', async () => {
    await controller.deactivate('plan-1');
    expect(service.deactivate).toHaveBeenCalledWith('plan-1');
  });

  it('reactivate delega en el servicio con el id', async () => {
    await controller.reactivate('plan-1');
    expect(service.reactivate).toHaveBeenCalledWith('plan-1');
  });

  describe('metadatos de guards (roles / público)', () => {
    it('los endpoints de lectura están marcados @Public', () => {
      expect(reflector.get(IS_PUBLIC_KEY, controller.findAll)).toBe(true);
      expect(reflector.get(IS_PUBLIC_KEY, controller.findFeatured)).toBe(true);
      expect(reflector.get(IS_PUBLIC_KEY, controller.findById)).toBe(true);
    });

    it('los endpoints mutantes exigen rol ADMIN o GERENTE', () => {
      expect(reflector.get(ROLES_KEY, controller.create)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.update)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.deactivate)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.reactivate)).toEqual([Role.ADMIN, Role.GERENTE]);
    });

    it('los endpoints mutantes NO están marcados @Public', () => {
      expect(reflector.get(IS_PUBLIC_KEY, controller.create)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.update)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.deactivate)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.reactivate)).toBeUndefined();
    });
  });
});
