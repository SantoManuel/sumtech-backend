import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DgiiClientService } from './dgii-client.service';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiXsdValidatorService } from './dgii-xsd-validator.service';
import { DgiiCertificationRun } from './entities/dgii-certification-run.entity';
import { CompanyService } from '../../company/company.service';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';

describe('DgiiClientService with CompanyService', () => {
  let service: DgiiClientService;
  let signerService: any;
  let xsdValidator: any;
  let runRepository: any;
  let companyService: any;
  let tenantContext: any;

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
      getDgiiSettings: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    };
    tenantContext = {
      hasContext: jest.fn().mockReturnValue(true),
      getSlug: jest.fn().mockReturnValue('sumtech'),
      getTenantId: jest.fn().mockReturnValue('tenant-default-uuid'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DgiiClientService,
        { provide: DgiiSignerService, useValue: signerService },
        { provide: DgiiXsdValidatorService, useValue: xsdValidator },
        { provide: getRepositoryToken(DgiiCertificationRun), useValue: runRepository },
        { provide: CompanyService, useValue: companyService },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get<DgiiClientService>(DgiiClientService);
  });

  it('getConfig debe resolver la configuración fiscal del tenant activo vía CompanyService', async () => {
    const config = await service.getConfig();

    expect(companyService.getCompanyFiscalInfo).toHaveBeenCalled();
    expect(config.rncEmisor).toBe('131000000');
    expect(config.razonSocialEmisor).toBe('SUMTECH TELECOM S.R.L.');
  });

  it('updateConfig debe persistir en el perfil del tenant activo a través de CompanyService, sin estado en memoria', async () => {
    companyService.getCompanyFiscalInfo.mockResolvedValueOnce({
      rnc: '132000000',
      razonSocial: 'SUMTECH DOMINICANA SRL',
    });

    await service.updateConfig({
      rncEmisor: '132000000',
      razonSocialEmisor: 'SUMTECH DOMINICANA SRL',
    });

    expect(companyService.update).toHaveBeenCalledWith(expect.objectContaining({
      rnc: '132000000',
      companyName: 'SUMTECH DOMINICANA SRL',
    }));

    const config = await service.getConfig();
    expect(config.rncEmisor).toBe('132000000');
  });

  it('updateConfig NO debe incluir dgiiCertPassword en el patch cuando certPassword viene vacío (evita borrar la contraseña real al guardar otros campos)', async () => {
    await service.updateConfig({
      rncEmisor: '132000000',
      certPassword: '',
    });

    const patch = companyService.update.mock.calls[0][0];
    expect(patch).not.toHaveProperty('dgiiCertPassword');
    expect(patch).toMatchObject({ rnc: '132000000' });
  });

  it('updateConfig SÍ debe incluir dgiiCertPassword en el patch cuando el usuario provee una contraseña nueva', async () => {
    await service.updateConfig({
      certPassword: 'nuevaClave123',
    });

    expect(companyService.update).toHaveBeenCalledWith(expect.objectContaining({
      dgiiCertPassword: 'nuevaClave123',
    }));
  });

  it('debe resolver RNC y certificado aislados para dos tenants diferentes en contextos distintos (Tenant A vs Tenant B)', async () => {
    // Tenant A
    tenantContext.getSlug.mockReturnValue('tenant_test_a');
    companyService.getCompanyFiscalInfo.mockResolvedValueOnce({
      rnc: '131000000',
      razonSocial: 'ISP AZUA TELECOM',
    });
    companyService.getDgiiSettings.mockResolvedValueOnce({
      environment: 'sandbox',
      certObjectKey: 'dgii-certs/tenant_a.p12',
      certPassword: 'pass_tenant_a',
    });
    companyService.getDgiiCertificateBuffer = jest.fn().mockResolvedValue(Buffer.from('CERT_A_BYTES'));

    const configA = await service.getConfig();
    expect(configA.rncEmisor).toBe('131000000');
    expect(configA.razonSocialEmisor).toBe('ISP AZUA TELECOM');
    expect(configA.certPassword).toBe('pass_tenant_a');

    // Tenant B
    tenantContext.getSlug.mockReturnValue('tenant_test_b');
    companyService.getCompanyFiscalInfo.mockResolvedValueOnce({
      rnc: '101999999',
      razonSocial: 'FIBRA SUR DOMINICANA',
    });
    companyService.getDgiiSettings.mockResolvedValueOnce({
      environment: 'testecf',
      certObjectKey: 'dgii-certs/tenant_b.p12',
      certPassword: 'pass_tenant_b',
    });
    companyService.getDgiiCertificateBuffer = jest.fn().mockResolvedValue(Buffer.from('CERT_B_BYTES'));

    const configB = await service.getConfig();
    expect(configB.rncEmisor).toBe('101999999');
    expect(configB.razonSocialEmisor).toBe('FIBRA SUR DOMINICANA');
    expect(configB.certPassword).toBe('pass_tenant_b');
    expect(configB.environment).toBe('testecf');
  });
});

describe('DgiiClientService — envío de RFCE y consulta de estado (sin CompanyService, solo env vars)', () => {
  let service: DgiiClientService;
  let signerService: any;
  let xsdValidator: any;
  let runRepository: any;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env.DGII_ENVIRONMENT = 'sandbox';
    process.env.DGII_CERT_PATH = './certs/test.p12';
    process.env.DGII_CERT_PASSWORD = 'pass';

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
        { provide: TenantContextService, useValue: { hasContext: jest.fn().mockReturnValue(false), getSlug: jest.fn(), getTenantId: jest.fn() } },
      ],
    }).compile();

    service = module.get<DgiiClientService>(DgiiClientService);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
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
