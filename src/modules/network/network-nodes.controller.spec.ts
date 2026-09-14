import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NetworkNodesController } from './network-nodes.controller';
import { NetworkNodesService } from './network-nodes.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums/role.enum';

describe('NetworkNodesController', () => {
  let controller: NetworkNodesController;
  let service: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue({ data: [{ id: 'node-1' }], total: 1, page: 1, limit: 20, totalPages: 1 }),
      findById: jest.fn().mockResolvedValue({ id: 'node-1' }),
      create: jest.fn().mockResolvedValue({ id: 'node-new' }),
      update: jest.fn().mockResolvedValue({ id: 'node-1', name: 'Actualizado' }),
      deactivate: jest.fn().mockResolvedValue({ id: 'node-1', isActive: false }),
      reactivate: jest.fn().mockResolvedValue({ id: 'node-1', isActive: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NetworkNodesController],
      providers: [
        { provide: NetworkNodesService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<NetworkNodesController>(NetworkNodesController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('findAll delega en el servicio pasando includeInactive invertido como activeOnly', async () => {
    const result = await controller.findAll({ page: 1, limit: 20, includeInactive: true } as any);
    expect(result.data).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, includeInactive: true }, false);
  });

  it('findAll pide solo nodos activos por defecto cuando no se pide includeInactive', async () => {
    await controller.findAll({ page: 1, limit: 20 } as any);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 }, true);
  });

  it('findById delega en el servicio con el id', async () => {
    await controller.findById('node-1');
    expect(service.findById).toHaveBeenCalledWith('node-1');
  });

  it('create delega en el servicio con el DTO', async () => {
    const dto = { name: 'Nuevo Nodo' } as any;
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('update delega en el servicio con id y DTO', async () => {
    await controller.update('node-1', { model: 'RB5009UG+S+' } as any);
    expect(service.update).toHaveBeenCalledWith('node-1', { model: 'RB5009UG+S+' });
  });

  it('deactivate delega en el servicio con el id', async () => {
    await controller.deactivate('node-1');
    expect(service.deactivate).toHaveBeenCalledWith('node-1');
  });

  it('reactivate delega en el servicio con el id', async () => {
    await controller.reactivate('node-1');
    expect(service.reactivate).toHaveBeenCalledWith('node-1');
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
