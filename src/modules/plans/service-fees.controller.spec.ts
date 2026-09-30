import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';
import { ServiceFeesController } from './service-fees.controller';
import { ServiceFeesService } from './service-fees.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums/role.enum';

describe('ServiceFeesController', () => {
  let controller: ServiceFeesController;
  let service: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue({ data: [{ id: 'fee-1' }], total: 1, page: 1, limit: 20, totalPages: 1 }),
      findById: jest.fn().mockResolvedValue({ id: 'fee-1' }),
      create: jest.fn().mockResolvedValue({ id: 'fee-new' }),
      update: jest.fn().mockResolvedValue({ id: 'fee-1', name: 'Actualizado' }),
      deactivate: jest.fn().mockResolvedValue({ id: 'fee-1', isActive: false }),
      reactivate: jest.fn().mockResolvedValue({ id: 'fee-1', isActive: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceFeesController],
      providers: [
        { provide: ServiceFeesService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: TenantContextService, useValue: { hasContext: jest.fn().mockReturnValue(false), getTenantId: jest.fn(), getSlug: jest.fn() } },
      ],
    }).compile();

    controller = module.get<ServiceFeesController>(ServiceFeesController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('findAll delega en el servicio pasando includeInactive invertido como activeOnly', async () => {
    const result = await controller.findAll({ page: 1, limit: 20, includeInactive: true } as any);
    expect(result.data).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, includeInactive: true }, false);
  });

  it('findAll pide solo cargos activos por defecto cuando no se pide includeInactive', async () => {
    await controller.findAll({ page: 1, limit: 20 } as any);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 }, true);
  });

  it('findById delega en el servicio con el id', async () => {
    await controller.findById('fee-1');
    expect(service.findById).toHaveBeenCalledWith('fee-1');
  });

  it('create delega en el servicio con el DTO', async () => {
    const dto = { name: 'Cargo Nuevo', feeType: 'INSTALLATION_FEE', price: 1500 } as any;
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('update delega en el servicio con id y DTO', async () => {
    await controller.update('fee-1', { name: 'Actualizado' } as any);
    expect(service.update).toHaveBeenCalledWith('fee-1', { name: 'Actualizado' });
  });

  it('deactivate delega en el servicio con el id', async () => {
    await controller.deactivate('fee-1');
    expect(service.deactivate).toHaveBeenCalledWith('fee-1');
  });

  it('reactivate delega en el servicio con el id', async () => {
    await controller.reactivate('fee-1');
    expect(service.reactivate).toHaveBeenCalledWith('fee-1');
  });

  describe('metadatos de guards (roles)', () => {
    it('los endpoints de lectura exigen ADMIN, GERENTE o CAJERO', () => {
      expect(reflector.get(ROLES_KEY, controller.findAll)).toEqual([Role.ADMIN, Role.GERENTE, Role.CAJERO]);
      expect(reflector.get(ROLES_KEY, controller.findById)).toEqual([Role.ADMIN, Role.GERENTE, Role.CAJERO]);
    });

    it('los endpoints mutantes exigen rol ADMIN o GERENTE (CAJERO no puede escribir el catálogo)', () => {
      expect(reflector.get(ROLES_KEY, controller.create)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.update)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.deactivate)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.reactivate)).toEqual([Role.ADMIN, Role.GERENTE]);
    });

    it('ningún endpoint está marcado @Public — a diferencia de Plans, este catálogo es interno', () => {
      expect(reflector.get(IS_PUBLIC_KEY, controller.findAll)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.findById)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.create)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.update)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.deactivate)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.reactivate)).toBeUndefined();
    });
  });
});
