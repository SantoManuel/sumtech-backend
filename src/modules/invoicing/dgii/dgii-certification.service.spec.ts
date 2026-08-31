import { Test, TestingModule } from '@nestjs/testing';
import { DgiiCertificationService, TestCaseItem } from './dgii-certification.service';
import { DgiiXmlGeneratorService } from './dgii-xml-generator.service';
import { DgiiClientService } from './dgii-client.service';
import { DgiiSignerService } from './dgii-signer.service';

describe('DgiiCertificationService', () => {
  let service: DgiiCertificationService;
  let xmlGenerator: DgiiXmlGeneratorService;
  let dgiiClient: any;
  let signerService: any;

  beforeEach(async () => {
    dgiiClient = {
      getConfig: jest.fn().mockReturnValue({
        environment: 'sandbox',
        rncEmisor: '131000000',
        razonSocialEmisor: 'SUMTECH TELECOM SRL',
        certPath: './certs/test.p12',
        certPassword: 'pass',
      }),
      submitEcf: jest.fn().mockResolvedValue({
        trackId: 'TRK-CERT-123456',
        status: 'ACCEPTED',
        securityCode: 'A1B2C3',
        qrCodeUrl: 'https://ecf.dgii.gov.do/testecf/consultatimbre',
        responseMessage: 'Comprobante Aceptado por DGII en Certificación',
        timestamp: new Date(),
        signedXml: '<ECF></ECF>',
      }),
      submitCommercialApproval: jest.fn().mockResolvedValue({
        trackId: 'TRK-ACE-123',
        estado: 'ACEPTADO',
        mensaje: 'Aprobación Comercial Aceptada',
      }),
      submitSequenceVoiding: jest.fn().mockResolvedValue({
        trackId: 'TRK-ANU-123',
        estado: 'ACEPTADO',
        mensaje: 'Anulación de secuencias Aceptada',
      }),
      testConnectionDiagnostic: jest.fn().mockResolvedValue({
        status: 'ONLINE',
        latencyMs: 45,
        tokenObtained: true,
      }),
    };

    signerService = {
      signXml: jest.fn().mockReturnValue({
        signedXml: '<ECF><Signature></Signature></ECF>',
        securityCode: 'A1B2C3',
        signatureValue: 'A1B2C3XYZ==',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DgiiCertificationService,
        DgiiXmlGeneratorService,
        { provide: DgiiClientService, useValue: dgiiClient },
        { provide: DgiiSignerService, useValue: signerService },
      ],
    }).compile();

    service = module.get<DgiiCertificationService>(DgiiCertificationService);
    xmlGenerator = module.get<DgiiXmlGeneratorService>(DgiiXmlGeneratorService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe listar los casos oficiales del Set de Pruebas DGII', () => {
    const cases = service.getDefaultTestSetCases();
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(cases[0].tipoeCF).toBe('E31');
    expect(cases[1].tipoeCF).toBe('E32');
  });

  it('debe generar exactamente los 25 comprobantes oficiales de la batería de Simulación (Paso 4)', () => {
    const dataset = service.get25SimulationDataset(100);
    expect(dataset.todosLosCasos.length).toBe(25);
    expect(dataset.ecfGenerales.length).toBe(18);
    expect(dataset.ecfNotas.length).toBe(3);
    expect(dataset.ecfConsumoMenor.length).toBe(4);

    // Verificar formato correlativo con offset
    expect(dataset.ecfGenerales[0].eNCF).toBe('E310000000101');
    expect(dataset.ecfNotas[0].eNCF).toBe('E330000000101');
  });

  it('debe ejecutar la simulación en 5 etapas del Paso 4', async () => {
    const result = await service.runSimulationStep4(0);
    expect(result.total).toBe(25);
    expect(result.etapa1Base.total).toBe(18);
    expect(result.etapa2Notas.total).toBe(3);
    expect(result.etapa3Rfce.total).toBe(4);
    expect(result.results.length).toBe(25);
  });

  it('debe ejecutar un caso individual del Set de Pruebas con generación de logs y resultado DGII', async () => {
    const caseItem: TestCaseItem = {
      id: 'tc-1',
      casoNumero: 1,
      nombreCaso: 'Prueba E31 Crédito Fiscal',
      tipoeCF: 'E31',
      eNCF: 'E3100000001',
      rncComprador: '130000001',
      razonSocialComprador: 'EMPRESA PRUEBA S.A.',
      montoTotal: 5000,
      itemsCount: 1,
      descripcion: 'Servicio de Internet Dedicado',
      status: 'PENDING',
      logs: [],
    };

    const result = await service.runTestCase(caseItem);

    expect(result.status).toBe('ACCEPTED');
    expect(result.trackId).toBe('TRK-CERT-123456');
    expect(result.securityCode).toBe('A1B2C3');
    expect(result.logs.length).toBeGreaterThan(3);
    expect(dgiiClient.submitEcf).toHaveBeenCalled();
  });

  it('debe emitir y transmitir una Aprobación Comercial (ACECF)', async () => {
    const result = await service.runCommercialApproval({
      rncEmisorProveedor: '130999999',
      eNcf: 'E3100000050',
      estadoAprobacion: 1,
      comentario: 'Servicio conforme y verificado por soporte técnico',
    });

    expect(result.estado).toBe('ACEPTADO');
    expect(dgiiClient.submitCommercialApproval).toHaveBeenCalled();
  });

  it('debe emitir y transmitir una Anulación de Secuencias (ANECF)', async () => {
    const result = await service.runSequenceVoiding({
      tipoComprobante: '32',
      secuenciaDesde: 'E3200000010',
      secuenciaHasta: 'E3200000020',
      motivo: 'Salto de correlativo por mantenimiento',
    });

    expect(result.estado).toBe('ACEPTADO');
    expect(dgiiClient.submitSequenceVoiding).toHaveBeenCalled();
  });
});
