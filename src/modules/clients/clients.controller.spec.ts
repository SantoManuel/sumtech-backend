import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ContractSignaturesService } from '../contract-signatures/contract-signatures.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

/**
 * Cubre únicamente los endpoints de firma electrónica de contratos, agregados
 * en esta iteración — el resto del controlador (clientes/contratos/pdf) no
 * tenía un spec propio antes de esto y queda fuera de alcance.
 */
describe('ClientsController - firmas de contrato', () => {
  let controller: ClientsController;
  let clientsService: any;
  let contractSignaturesService: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    clientsService = {};
    contractSignaturesService = {
      getStatus: jest.fn().mockResolvedValue({ client: null, company: null }),
      create: jest.fn().mockResolvedValue({ id: 'sig-1', party: 'CLIENT' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [
        { provide: ClientsService, useValue: clientsService },
        { provide: ContractSignaturesService, useValue: contractSignaturesService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<ClientsController>(ClientsController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('GET .../signatures delega en ContractSignaturesService.getStatus con clientId y contractId', async () => {
    const result = await controller.getContractSignatures('client-1', 'contract-1');

    expect(contractSignaturesService.getStatus).toHaveBeenCalledWith('client-1', 'contract-1');
    expect(result).toEqual({ client: null, company: null });
  });

  it('exige uno de los roles habilitados (ADMIN/GERENTE/CAJERO/AGENTE_CRM/TECNICO) en GET .../signatures', () => {
    expect(reflector.get(ROLES_KEY, controller.getContractSignatures)).toEqual([
      Role.ADMIN,
      Role.GERENTE,
      Role.CAJERO,
      Role.AGENTE_CRM,
      Role.TECNICO,
    ]);
  });

  it('POST .../signatures delega en ContractSignaturesService.create con el actor armado desde el JWT y la IP de la request', async () => {
    const req: any = { ip: '10.0.0.42' };
    const dto: any = { party: 'CLIENT', signatureImageBase64: 'xxx', signedByName: 'Carlos Mendoza', method: 'DRAW' };

    const result = await controller.createContractSignature('client-1', 'contract-1', dto, 'user-1', 'employee-1', [Role.CAJERO], req);

    expect(contractSignaturesService.create).toHaveBeenCalledWith('client-1', 'contract-1', dto, {
      userId: 'user-1',
      employeeId: 'employee-1',
      roles: [Role.CAJERO],
      ipAddress: '10.0.0.42',
    });
    expect(result).toEqual({ id: 'sig-1', party: 'CLIENT' });
  });

  it('POST .../signatures no revienta si el JWT no trae "roles" (defensivo — arma un arreglo vacío)', async () => {
    const req: any = { ip: '10.0.0.42' };
    const dto: any = { party: 'CLIENT', signatureImageBase64: 'xxx', signedByName: 'Carlos Mendoza', method: 'DRAW' };

    await controller.createContractSignature('client-1', 'contract-1', dto, 'user-1', undefined, undefined as any, req);

    expect(contractSignaturesService.create).toHaveBeenCalledWith(
      'client-1',
      'contract-1',
      dto,
      expect.objectContaining({ roles: [] }),
    );
  });

  it('exige uno de los roles habilitados en POST .../signatures', () => {
    expect(reflector.get(ROLES_KEY, controller.createContractSignature)).toEqual([
      Role.ADMIN,
      Role.GERENTE,
      Role.CAJERO,
      Role.AGENTE_CRM,
      Role.TECNICO,
    ]);
  });
});
