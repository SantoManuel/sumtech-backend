import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GenieAcsController } from './genieacs.controller';
import { GenieAcsMonitoringService } from './genieacs-monitoring.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

describe('GenieAcsController', () => {
  let controller: GenieAcsController;
  let service: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    service = {
      getLiveStatus: jest.fn().mockResolvedValue({ linked: false }),
      rebootDevice: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GenieAcsController],
      providers: [
        { provide: GenieAcsMonitoringService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<GenieAcsController>(GenieAcsController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('getStatus delega en el servicio con el contractId', async () => {
    service.getLiveStatus.mockResolvedValue({ linked: true, onlineStatus: 'ONLINE' });

    const result = await controller.getStatus('11111111-1111-4111-8111-111111111111');

    expect(service.getLiveStatus).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(result).toEqual({ linked: true, onlineStatus: 'ONLINE' });
  });

  it('reboot delega en el servicio con contractId y el userId autenticado como actor', async () => {
    const result = await controller.reboot('11111111-1111-4111-8111-111111111111', 'admin-1');

    expect(service.rebootDevice).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'admin-1');
    expect(result.success).toBe(true);
  });

  it('exige rol ADMIN o GERENTE en getStatus', () => {
    expect(reflector.get(ROLES_KEY, controller.getStatus)).toEqual([Role.ADMIN, Role.GERENTE]);
  });

  it('exige rol ADMIN o GERENTE en reboot', () => {
    expect(reflector.get(ROLES_KEY, controller.reboot)).toEqual([Role.ADMIN, Role.GERENTE]);
  });
});
