import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';
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
      revealPppoePassword: jest.fn().mockResolvedValue({ hasPassword: true, password: 'ClaveReal123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NetworkAccessController],
      providers: [
        { provide: NetworkProvisioningService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: TenantContextService, useValue: { hasContext: jest.fn().mockReturnValue(false), getTenantId: jest.fn(), getSlug: jest.fn() } },
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
    // pppoePasswordEnc nunca debe llegar al cliente HTTP; se reemplaza por hasPppoePassword
    expect(result).toEqual({ id: 'access-1', connectionStatus: 'ACTIVE', hasPppoePassword: false });
  });

  it('nunca devuelve pppoePasswordEnc, aunque el servicio lo incluya en la entidad', async () => {
    service.upsertConfiguration.mockResolvedValueOnce({
      id: 'access-2',
      connectionStatus: 'ACTIVE',
      pppoePasswordEnc: 'iv:tag:ciphertext',
    });
    const result = await controller.upsert('client-1', 'contract-1', { nodeId: 'node-1' } as any);

    expect(result).not.toHaveProperty('pppoePasswordEnc');
    expect(result).toEqual({ id: 'access-2', connectionStatus: 'ACTIVE', hasPppoePassword: true });
  });

  it('exige rol ADMIN o GERENTE', () => {
    expect(reflector.get(ROLES_KEY, controller.upsert)).toEqual([Role.ADMIN, Role.GERENTE]);
  });

  it('revealPppoePassword delega en el servicio con clientId, contractId y el usuario actor', async () => {
    const result = await controller.revealPppoePassword('client-1', 'contract-1', 'user-42');

    expect(service.revealPppoePassword).toHaveBeenCalledWith('client-1', 'contract-1', 'user-42');
    expect(result).toEqual({ hasPassword: true, password: 'ClaveReal123' });
  });

  it('revealPppoePassword exige rol ADMIN o GERENTE', () => {
    expect(reflector.get(ROLES_KEY, controller.revealPppoePassword)).toEqual([Role.ADMIN, Role.GERENTE]);
  });
});
