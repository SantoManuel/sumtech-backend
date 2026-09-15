import { Test, TestingModule } from '@nestjs/testing';
import { DgiiClientService } from './dgii-client.service';
import { DgiiSignerService } from './dgii-signer.service';
import { CompanyService } from '../../company/company.service';

describe('DgiiClientService with CompanyService', () => {
  let service: DgiiClientService;
  let signerService: any;
  let companyService: any;

  beforeEach(async () => {
    signerService = {};
    companyService = {
      getCompanyFiscalInfo: jest.fn().mockResolvedValue({
        rnc: '131000000',
        razonSocial: 'SUMTECH TELECOM S.R.L.',
        nombreComercial: 'SUMTECH FIBRA & TV',
        direccion: 'Av. 27 de Febrero esq. Winston Churchill, Santo Domingo, D.N.',
        municipio: '010100',
        provincia: '010000',
        correo: 'facturacion@sumtech.com.do',
        telefono: '809-555-0199',
        website: 'https://sumtech.com.do',
      }),
      getDefaultTenant: jest.fn().mockResolvedValue({ id: 'tenant-default-uuid' }),
      update: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DgiiClientService,
        { provide: DgiiSignerService, useValue: signerService },
        { provide: CompanyService, useValue: companyService },
      ],
    }).compile();

    service = module.get<DgiiClientService>(DgiiClientService);
  });

  it('debe sincronizar los datos de la empresa al iniciar onModuleInit', async () => {
    await service.onModuleInit();
    const config = service.getConfig();

    expect(companyService.getCompanyFiscalInfo).toHaveBeenCalled();
    expect(config.rncEmisor).toBe('131000000');
    expect(config.razonSocialEmisor).toBe('SUMTECH TELECOM S.R.L.');
  });

  it('updateConfig debe actualizar memoria y persistir en BD a través de CompanyService', async () => {
    await service.updateConfig({
      rncEmisor: '132000000',
      razonSocialEmisor: 'SUMTECH DOMINICANA SRL',
    });

    const config = service.getConfig();
    expect(config.rncEmisor).toBe('132000000');
    expect(companyService.update).toHaveBeenCalledWith('tenant-default-uuid', expect.objectContaining({
      rnc: '132000000',
      companyName: 'SUMTECH DOMINICANA SRL',
    }));
  });
});
