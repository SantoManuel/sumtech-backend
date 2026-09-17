import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DgiiClientService } from './dgii-client.service';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiXsdValidatorService } from './dgii-xsd-validator.service';
import { DgiiCertificationRun } from './entities/dgii-certification-run.entity';
import { CompanyService } from '../../company/company.service';

describe('DgiiClientService with CompanyService', () => {
  let service: DgiiClientService;
  let signerService: any;
  let xsdValidator: any;
  let runRepository: any;
  let companyService: any;

  beforeEach(async () => {
    signerService = {};
    xsdValidator = {};
    runRepository = { findOne: jest.fn().mockResolvedValue(null) };
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
        { provide: DgiiXsdValidatorService, useValue: xsdValidator },
        { provide: getRepositoryToken(DgiiCertificationRun), useValue: runRepository },
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

describe('DgiiClientService — envío de RFCE y consulta de estado', () => {
  let service: DgiiClientService;
  let signerService: any;
  let xsdValidator: any;
  let runRepository: any;

  beforeEach(async () => {
    signerService = {
      signXml: jest.fn().mockReturnValue({ signedXml: '<RFCE><Signature/></RFCE>', securityCode: 'ABC123', signatureValue: 'ABC123XYZ==' }),
    };
    xsdValidator = {
      validateRfce: jest.fn().mockReturnValue({ valid: true, errors: [] }),
      validateEcf: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    };
    runRepository = { findOne: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DgiiClientService,
        { provide: DgiiSignerService, useValue: signerService },
        { provide: DgiiXsdValidatorService, useValue: xsdValidator },
        { provide: getRepositoryToken(DgiiCertificationRun), useValue: runRepository },
      ],
    }).compile();

    service = module.get<DgiiClientService>(DgiiClientService);
    await service.updateConfig({ environment: 'sandbox' as any, certPath: './certs/test.p12', certPassword: 'pass' });
  });

  it('submitRfce en sandbox firma, valida contra el XSD y devuelve un resultado simulado ACCEPTED', async () => {
    const result = await service.submitRfce('<RFCE></RFCE>', 'E3200000099', 4130);

    expect(signerService.signXml).toHaveBeenCalledWith('<RFCE></RFCE>', './certs/test.p12', 'pass');
    expect(xsdValidator.validateRfce).toHaveBeenCalledWith('<RFCE><Signature/></RFCE>');
    expect(result.status).toBe('ACCEPTED');
    expect(result.securityCode).toBe('ABC123');
    expect(result.trackId).toMatch(/^TRK-SBX-RFCE-/);
  });

  it('submitRfce rechaza localmente (sin intentar red) si el XSD de la DGII no valida', async () => {
    xsdValidator.validateRfce.mockReturnValue({ valid: false, errors: ["Element 'CodigoSeguridadeCF': missing"] });

    const result = await service.submitRfce('<RFCE></RFCE>', 'E3200000099', 4130);

    expect(result.status).toBe('REJECTED');
    expect(result.validationErrors).toEqual(["Element 'CodigoSeguridadeCF': missing"]);
    expect(result.trackId).toMatch(/^TRK-XSD-ERR-/);
  });

  it('submitEcf rechaza localmente si el XSD no valida, sin intentar enviar a la DGII', async () => {
    xsdValidator.validateEcf.mockReturnValue({ valid: false, errors: ['error de esquema'] });

    const result = await service.submitEcf('<ECF></ECF>', 'E3100000001', 5000, 'E31');

    expect(result.status).toBe('REJECTED');
    expect(result.validationErrors).toEqual(['error de esquema']);
  });

  it('queryTrackIdStatus (sandbox) devuelve el estado real persistido para un TrackId conocido', async () => {
    runRepository.findOne.mockResolvedValue({ status: 'REJECTED', responseMessage: 'Rechazado por datos inválidos' });

    const result = await service.queryTrackIdStatus('TRK-SBX-12345');

    expect(result.estado).toBe('RECHAZADO');
    expect(result.mensaje).toBe('Rechazado por datos inválidos');
  });

  it('queryTrackIdStatus (sandbox) devuelve NO_ENCONTRADO si el TrackId no está en el historial', async () => {
    runRepository.findOne.mockResolvedValue(null);

    const result = await service.queryTrackIdStatus('TRK-SBX-99999');

    expect(result.estado).toBe('NO_ENCONTRADO');
    expect(result.codigo).toBe('404');
  });

  it('queryTrackIdStatus (sandbox) mapea ACCEPTED -> ACEPTADO y CONTINGENCY -> CONTINGENCIA', async () => {
    runRepository.findOne.mockResolvedValueOnce({ status: 'ACCEPTED', responseMessage: 'ok' });
    const aceptado = await service.queryTrackIdStatus('TRK-SBX-1');
    expect(aceptado.estado).toBe('ACEPTADO');

    runRepository.findOne.mockResolvedValueOnce({ status: 'CONTINGENCY', responseMessage: 'contingencia' });
    const contingencia = await service.queryTrackIdStatus('TRK-CONTINGENCY-2');
    expect(contingencia.estado).toBe('CONTINGENCIA');
  });
});
