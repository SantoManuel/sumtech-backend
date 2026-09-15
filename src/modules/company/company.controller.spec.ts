import { Test, TestingModule } from '@nestjs/testing';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('CompanyController', () => {
  let controller: CompanyController;
  let service: any;

  const mockTenant = {
    id: '11111111-1111-1111-1111-111111111111',
    tenantCode: 'DEFAULT',
    name: 'Sumtech Telecom',
    companyName: 'SUMTECH TELECOM S.R.L.',
    rnc: '131000000',
    isDefault: true,
  };

  beforeEach(async () => {
    service = {
      getDefaultTenant: jest.fn().mockResolvedValue(mockTenant),
      findAll: jest.fn().mockResolvedValue([mockTenant]),
      findById: jest.fn().mockResolvedValue(mockTenant),
      create: jest.fn().mockResolvedValue(mockTenant),
      update: jest.fn().mockResolvedValue({ ...mockTenant, companyName: 'UPDATED' }),
      setDefault: jest.fn().mockResolvedValue(mockTenant),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompanyController],
      providers: [
        { provide: CompanyService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('dev-secret') } },
      ],
    }).compile();

    controller = module.get<CompanyController>(CompanyController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('getConfig debe retornar el tenant por defecto', async () => {
    const res = await controller.getConfig();
    expect(res).toEqual(mockTenant);
    expect(service.getDefaultTenant).toHaveBeenCalled();
  });

  it('updateConfig debe actualizar el tenant por defecto', async () => {
    const res = await controller.updateConfig({ companyName: 'UPDATED' });
    expect(res.companyName).toBe('UPDATED');
    expect(service.update).toHaveBeenCalledWith(mockTenant.id, { companyName: 'UPDATED' });
  });

  it('listTenants debe delegar a service.findAll', async () => {
    const res = await controller.listTenants('true');
    expect(res).toEqual([mockTenant]);
    expect(service.findAll).toHaveBeenCalledWith(true);
  });

  it('createTenant debe llamar a service.create', async () => {
    const dto = {
      tenantCode: 'SUC-01',
      name: 'Sucursal 1',
      companyName: 'Sumtech Santiago',
      rnc: '131000000',
    };
    await controller.createTenant(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });
});
