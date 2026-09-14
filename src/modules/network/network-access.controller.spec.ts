import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NetworkAccessController } from './network-access.controller';
import { NetworkProvisioningService } from './network-provisioning.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

describe('NetworkAccessController', () => {
  let controller: NetworkAccessController;
  let service: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    service = {
      upsertConfiguration: jest.fn().mockResolvedValue({ id: 'access-1', connectionStatus: 'ACTIVE' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NetworkAccessController],
      providers: [
        { provide: NetworkProvisioningService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<NetworkAccessController>(NetworkAccessController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('upsert delega en el servicio con clientId, contractId y el DTO', async () => {
    const dto = { nodeId: 'node-1', username: 't1' };
    const result = await controller.upsert('client-1', 'contract-1', dto as any);

    expect(service.upsertConfiguration).toHaveBeenCalledWith('client-1', 'contract-1', dto);
    expect(result).toEqual({ id: 'access-1', connectionStatus: 'ACTIVE' });
  });

  it('exige rol ADMIN o GERENTE', () => {
    expect(reflector.get(ROLES_KEY, controller.upsert)).toEqual([Role.ADMIN, Role.GERENTE]);
  });
});
