import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DgiiCertificationService, TestCaseItem } from './dgii-certification.service';
import { DgiiXmlGeneratorService } from './dgii-xml-generator.service';
import { DgiiClientService } from './dgii-client.service';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiCertificationRun } from './entities/dgii-certification-run.entity';

describe('DgiiCertificationService', () => {
  let service: DgiiCertificationService;
  let xmlGenerator: DgiiXmlGeneratorService;
  let dgiiClient: any;
  let signerService: any;
  let runRepository: any;

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
      submitRfce: jest.fn().mockResolvedValue({
        trackId: 'TRK-RFCE-123456',
        status: 'ACCEPTED',
        securityCode: 'B2C3D4',
        qrCodeUrl: 'https://fc.dgii.gov.do/testecf/consultatimbrefc',
        responseMessage: 'Resumen RFCE Aceptado por DGII',
        timestamp: new Date(),
        signedXml: '<RFCE></RFCE>',
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

    runRepository = {
      create: jest.fn((data: any) => data),
      save: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DgiiCertificationService,
        DgiiXmlGeneratorService,
        { provide: DgiiClientService, useValue: dgiiClient },
        { provide: DgiiSignerService, useValue: signerService },
        { provide: getRepositoryToken(DgiiCertificationRun), useValue: runRepository },
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
      fechaEmisionEcf: new Date('2026-01-10T00:00:00'),
      montoTotalEcf: 5074,
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

  describe('persistencia del historial de certificación', () => {
    const rfceCase: TestCaseItem = {
      id: 'rfce-1',
      casoNumero: 1,
      nombreCaso: 'Resumen RFCE de prueba',
      tipoeCF: 'E32',
      eNCF: 'E3200000099',
      rncComprador: '131880681',
      razonSocialComprador: 'CLIENTE PRUEBA RFCE',
      montoTotal: 4130,
      itemsCount: 1,
      descripcion: 'Plan Residencial 50 Mbps',
      status: 'PENDING',
      logs: [],
      esRfce: true,
    };

    it('un caso RFCE se firma localmente y se transmite por submitRfce, NO por submitEcf', async () => {
      const result = await service.runTestCase(rfceCase);

      expect(dgiiClient.submitRfce).toHaveBeenCalledWith(expect.any(String), 'E3200000099', 4130);
      expect(dgiiClient.submitEcf).not.toHaveBeenCalled();
      expect(signerService.signXml).toHaveBeenCalled(); // firma local del e-CF de consumo subyacente
      expect(result.status).toBe('ACCEPTED');
      expect(result.trackId).toBe('TRK-RFCE-123456');
    });

    it('cada corrida se persiste en el repositorio de historial (dgii_certification_runs)', async () => {
      const caseItem: TestCaseItem = {
        id: 'tc-persist-1', casoNumero: 1, nombreCaso: 'Prueba persistencia', tipoeCF: 'E31',
        eNCF: 'E3100000077', rncComprador: '130000001', razonSocialComprador: 'EMPRESA X',
        montoTotal: 5000, itemsCount: 1, descripcion: 'Servicio', status: 'PENDING', logs: [],
      };

      await service.runTestCase(caseItem);

      expect(runRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ eNcf: 'E3100000077', status: 'ACCEPTED', trackId: 'TRK-CERT-123456' }),
      );
      expect(runRepository.save).toHaveBeenCalled();
    });

    it('bloquea una nota de crédito/débito si su e-CF base no está aceptado en el historial (evita el error 615 de la DGII)', async () => {
      runRepository.findOne.mockResolvedValueOnce(null); // sin ninguna corrida registrada para el e-CF base

      const nota: TestCaseItem = {
        id: 'nota-1', casoNumero: 1, nombreCaso: 'Nota de crédito', tipoeCF: 'E34',
        eNCF: 'E3400000077', razonSocialComprador: 'EMPRESA X', montoTotal: 500,
        itemsCount: 1, descripcion: 'Ajuste', status: 'PENDING', logs: [],
        eNCFModificado: 'E3100000001',
      };

      const result = await service.runTestCase(nota);

      expect(result.status).toBe('ERROR');
      expect(result.logs.some((l) => l.includes('bloqueada'))).toBe(true);
      expect(dgiiClient.submitEcf).not.toHaveBeenCalled();
    });

    it('bloquea una nota si el e-CF base existe pero NO fue aceptado (ej. quedó REJECTED)', async () => {
      runRepository.findOne.mockResolvedValueOnce({ status: 'REJECTED', eNcf: 'E3100000001' });

      const nota: TestCaseItem = {
        id: 'nota-2', casoNumero: 1, nombreCaso: 'Nota de crédito', tipoeCF: 'E34',
        eNCF: 'E3400000078', razonSocialComprador: 'EMPRESA X', montoTotal: 500,
        itemsCount: 1, descripcion: 'Ajuste', status: 'PENDING', logs: [],
        eNCFModificado: 'E3100000001',
      };

      const result = await service.runTestCase(nota);

      expect(result.status).toBe('ERROR');
      expect(dgiiClient.submitEcf).not.toHaveBeenCalled();
    });

    it('permite emitir la nota cuando el e-CF base SÍ está ACCEPTED en el historial', async () => {
      runRepository.findOne.mockResolvedValueOnce({ status: 'ACCEPTED', eNcf: 'E3100000001' });

      const nota: TestCaseItem = {
        id: 'nota-3', casoNumero: 1, nombreCaso: 'Nota de crédito', tipoeCF: 'E34',
        eNCF: 'E3400000079', razonSocialComprador: 'EMPRESA X', montoTotal: 500,
        itemsCount: 1, descripcion: 'Ajuste', status: 'PENDING', logs: [],
        eNCFModificado: 'E3100000001',
      };

      const result = await service.runTestCase(nota);

      expect(result.status).toBe('ACCEPTED');
      expect(dgiiClient.submitEcf).toHaveBeenCalled();
    });

    it('getCertificationHistory devuelve el historial paginado del repositorio', async () => {
      runRepository.findAndCount.mockResolvedValueOnce([
        [{ id: 'run-1', eNcf: 'E3100000001', status: 'ACCEPTED' }],
        1,
      ]);

      const history = await service.getCertificationHistory(1, 20);

      expect(history.total).toBe(1);
      expect(history.runs).toHaveLength(1);
      expect(runRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { executedAt: 'DESC' }, skip: 0, take: 20 }),
      );
    });

    it('getCertificationHistory limita page/limit a valores seguros (page>=1, limit<=100)', async () => {
      await service.getCertificationHistory(0, 500);

      expect(runRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });
  });
});
