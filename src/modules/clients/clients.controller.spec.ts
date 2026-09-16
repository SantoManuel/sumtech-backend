import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientsExportService } from './export/clients-export.service';
import { ContractSignaturesService } from '../contract-signatures/contract-signatures.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

/**
 * Cubre únicamente los endpoints de firma electrónica de contratos y de
 * exportación de clientes, agregados en distintas iteraciones — el resto del
 * controlador (clientes/contratos/pdf) no tenía un spec propio antes de esto
 * y queda fuera de alcance.
 */
describe('ClientsController - firmas de contrato y export', () => {
  let controller: ClientsController;
  let clientsService: any;
  let clientsExportService: any;
  let contractSignaturesService: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    clientsService = {};
    clientsExportService = {
      export: jest.fn().mockResolvedValue({
        buffer: Buffer.from('contenido'),
        filename: 'clientes_20260316_0900.csv',
        contentType: 'text/csv; charset=utf-8',
        totalExportado: 1,
      }),
    };
    contractSignaturesService = {
      getStatus: jest.fn().mockResolvedValue({ client: null, company: null }),
      create: jest.fn().mockResolvedValue({ id: 'sig-1', party: 'CLIENT' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [
        { provide: ClientsService, useValue: clientsService },
        { provide: ClientsExportService, useValue: clientsExportService },
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

  describe('GET /clients/export', () => {
    it('exige exclusivamente ADMIN o GERENTE (ni CAJERO, ni AGENTE_CRM, ni TECNICO pueden exportar)', () => {
      expect(reflector.get(ROLES_KEY, controller.exportClients)).toEqual([Role.ADMIN, Role.GERENTE]);
    });

    it('delega en ClientsExportService.export con el DTO, el userId/username del JWT y la IP de la request', async () => {
      const dto: any = { format: 'csv', limit: 100 };
      const req: any = { ip: '10.0.0.42' };
      const res: any = { set: jest.fn(), end: jest.fn() };

      await controller.exportClients(dto, 'user-1', 'admin1', req, res);

      expect(clientsExportService.export).toHaveBeenCalledWith(dto, 'user-1', 'admin1', '10.0.0.42');
    });

    it('setea Content-Type, Content-Disposition (attachment) y Content-Length según el resultado del servicio, y escribe el buffer', async () => {
      const dto: any = { format: 'excel', limit: 500 };
      const req: any = { ip: '10.0.0.42' };
      const res: any = { set: jest.fn(), end: jest.fn() };
      const buffer = Buffer.from('xlsx-content');
      clientsExportService.export.mockResolvedValue({
        buffer,
        filename: 'clientes_20260316_0900.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        totalExportado: 3,
      });

      await controller.exportClients(dto, 'user-1', 'admin1', req, res);

      expect(res.set).toHaveBeenCalledWith({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="clientes_20260316_0900.xlsx"',
        'Content-Length': buffer.length,
      });
      expect(res.end).toHaveBeenCalledWith(buffer);
    });

    it('propaga el error (ej. BadRequestException de límite excedido para PDF) sin llegar a escribir la respuesta', async () => {
      const dto: any = { format: 'pdf', limit: 5000 };
      const req: any = { ip: '10.0.0.42' };
      const res: any = { set: jest.fn(), end: jest.fn() };
      clientsExportService.export.mockRejectedValue(new Error('límite excedido'));

      await expect(controller.exportClients(dto, 'user-1', 'admin1', req, res)).rejects.toThrow('límite excedido');
      expect(res.set).not.toHaveBeenCalled();
      expect(res.end).not.toHaveBeenCalled();
    });
  });
});
