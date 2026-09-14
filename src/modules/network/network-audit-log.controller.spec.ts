import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NetworkAuditLogController } from './network-audit-log.controller';
import { NetworkProvisioningService } from './network-provisioning.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

describe('NetworkAuditLogController', () => {
  let controller: NetworkAuditLogController;
  let service: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    service = {
      findAuditLog: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NetworkAuditLogController],
      providers: [
        { provide: NetworkProvisioningService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<NetworkAuditLogController>(NetworkAuditLogController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('findAll delega en el servicio con el DTO de filtros recibido', async () => {
    const dto = { contractId: 'contract-1', page: 2, limit: 5 };
    const result = await controller.findAll(dto as any);

    expect(service.findAuditLog).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
  });

  it('exige rol ADMIN o GERENTE', () => {
    expect(reflector.get(ROLES_KEY, controller.findAll)).toEqual([Role.ADMIN, Role.GERENTE]);
  });
});
