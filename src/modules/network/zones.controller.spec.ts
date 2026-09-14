import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums/role.enum';

describe('ZonesController', () => {
  let controller: ZonesController;
  let service: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue({ data: [{ id: 'zone-1' }], total: 1, page: 1, limit: 20, totalPages: 1 }),
      findById: jest.fn().mockResolvedValue({ id: 'zone-1' }),
      create: jest.fn().mockResolvedValue({ id: 'zone-new' }),
      update: jest.fn().mockResolvedValue({ id: 'zone-1', name: 'Actualizada' }),
      deactivate: jest.fn().mockResolvedValue({ id: 'zone-1', isActive: false }),
      reactivate: jest.fn().mockResolvedValue({ id: 'zone-1', isActive: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ZonesController],
      providers: [
        { provide: ZonesService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<ZonesController>(ZonesController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('findAll delega en el servicio pasando includeInactive invertido como activeOnly', async () => {
    const result = await controller.findAll({ page: 1, limit: 20, includeInactive: true } as any);
    expect(result.data).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, includeInactive: true }, false);
  });

  it('findAll pide solo zonas activas por defecto cuando no se pide includeInactive', async () => {
    await controller.findAll({ page: 1, limit: 20 } as any);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 }, true);
  });

  it('findById delega en el servicio con el id', async () => {
    await controller.findById('zone-1');
    expect(service.findById).toHaveBeenCalledWith('zone-1');
  });

  it('create delega en el servicio con el DTO', async () => {
    const dto = { name: 'Nueva Zona' } as any;
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('update delega en el servicio con id y DTO', async () => {
    await controller.update('zone-1', { name: 'Actualizada' } as any);
    expect(service.update).toHaveBeenCalledWith('zone-1', { name: 'Actualizada' });
  });

  it('deactivate delega en el servicio con el id', async () => {
    await controller.deactivate('zone-1');
    expect(service.deactivate).toHaveBeenCalledWith('zone-1');
  });

  it('reactivate delega en el servicio con el id', async () => {
    await controller.reactivate('zone-1');
    expect(service.reactivate).toHaveBeenCalledWith('zone-1');
  });

  describe('metadatos de guards (roles)', () => {
    it('todos los endpoints exigen rol ADMIN o GERENTE', () => {
      expect(reflector.get(ROLES_KEY, controller.findAll)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.findById)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.create)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.update)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.deactivate)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.reactivate)).toEqual([Role.ADMIN, Role.GERENTE]);
    });

    it('ningún endpoint es público: este catálogo es interno, no de cara al cliente', () => {
      expect(reflector.get(IS_PUBLIC_KEY, controller.findAll)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.findById)).toBeUndefined();
    });
  });
});
