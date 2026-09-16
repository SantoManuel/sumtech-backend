import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClientsImportController } from './clients-import.controller';
import { ClientsImportService } from './import/clients-import.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

describe('ClientsImportController', () => {
  let controller: ClientsImportController;
  let service: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    service = {
      analyze: jest.fn().mockResolvedValue({ batchId: 'batch-1', totalRows: 10 }),
      listBatches: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 15, totalPages: 0 }),
      getStatus: jest.fn().mockResolvedValue({ id: 'batch-1', status: 'ANALYZED' }),
      getErrors: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 }),
      submitLocationMapping: jest.fn().mockResolvedValue({ resolved: true, missingKeys: [] }),
      confirm: jest.fn().mockResolvedValue(undefined),
      getCredentialsReport: jest.fn().mockResolvedValue({ buffer: Buffer.from('csv'), filename: 'credenciales_batch-1.csv' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsImportController],
      providers: [
        { provide: ClientsImportService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<ClientsImportController>(ClientsImportController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('exige ADMIN o GERENTE a nivel de controlador (todos los endpoints)', () => {
    expect(reflector.get(ROLES_KEY, ClientsImportController)).toEqual([Role.ADMIN, Role.GERENTE]);
  });

  it('POST / delega en ClientsImportService.analyze con el archivo y el userId del JWT', async () => {
    const file = { originalname: 'clientes.csv', buffer: Buffer.from('x') } as Express.Multer.File;
    const result = await controller.analyze(file, 'user-1');

    expect(service.analyze).toHaveBeenCalledWith(file, 'user-1');
    expect(result).toEqual({ batchId: 'batch-1', totalRows: 10 });
  });

  it('GET / delega en ClientsImportService.listBatches con la paginación', async () => {
    const pagination: any = { page: 2, limit: 10 };
    await controller.listBatches(pagination);
    expect(service.listBatches).toHaveBeenCalledWith(pagination);
  });

  it('GET /:batchId delega en ClientsImportService.getStatus', async () => {
    await controller.getStatus('batch-1');
    expect(service.getStatus).toHaveBeenCalledWith('batch-1');
  });

  it('GET /:batchId/errors delega en ClientsImportService.getErrors', async () => {
    const pagination: any = { page: 1, limit: 50 };
    await controller.getErrors('batch-1', pagination);
    expect(service.getErrors).toHaveBeenCalledWith('batch-1', pagination);
  });

  it('PATCH /:batchId/location-mapping delega en ClientsImportService.submitLocationMapping', async () => {
    const dto: any = { mappings: [{ legacyLocationKey: 'X||Y', sectorId: 'sector-1' }] };
    await controller.submitLocationMapping('batch-1', dto);
    expect(service.submitLocationMapping).toHaveBeenCalledWith('batch-1', dto);
  });

  it('POST /:batchId/confirm delega en ClientsImportService.confirm y responde { status: QUEUED }', async () => {
    const result = await controller.confirm('batch-1');
    expect(service.confirm).toHaveBeenCalledWith('batch-1');
    expect(result).toEqual({ status: 'QUEUED' });
  });

  it('GET /:batchId/credentials-report delega en ClientsImportService.getCredentialsReport y escribe el CSV como adjunto', async () => {
    const res: any = { set: jest.fn(), end: jest.fn() };
    const buffer = Buffer.from('csv-content');
    service.getCredentialsReport.mockResolvedValue({ buffer, filename: 'credenciales_batch-1.csv' });

    await controller.getCredentialsReport('batch-1', res);

    expect(service.getCredentialsReport).toHaveBeenCalledWith('batch-1');
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="credenciales_batch-1.csv"',
      'Content-Length': buffer.length,
    });
    expect(res.end).toHaveBeenCalledWith(buffer);
  });
});
