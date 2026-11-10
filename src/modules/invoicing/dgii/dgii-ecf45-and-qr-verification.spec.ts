import { Test, TestingModule } from '@nestjs/testing';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiXmlGeneratorService, buildQrUrlFromSignedXml, parseSignedEcfMetadata } from './dgii-xml-generator.service';
import { DgiiXsdValidatorService } from './dgii-xsd-validator.service';

describe('DGII e-CF 45, Firma Digital XMLDSig y Código QR (Verificación Integral)', () => {
  let signerService: DgiiSignerService;
  let xmlGenerator: DgiiXmlGeneratorService;
  let xsdValidator: DgiiXsdValidatorService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DgiiSignerService,
        DgiiXmlGeneratorService,
        DgiiXsdValidatorService,
      ],
    }).compile();

    signerService = module.get<DgiiSignerService>(DgiiSignerService);
    xmlGenerator = module.get<DgiiXmlGeneratorService>(DgiiXmlGeneratorService);
    xsdValidator = module.get<DgiiXsdValidatorService>(DgiiXsdValidatorService);
  });

  describe('e-CF Tipo 45 (Comprobante Gubernamental Electrónico)', () => {
    const certPath = './certs/22817887_identity.p12';
    const certPassword = process.env.DGII_CERT_PASSWORD || 'hagmauhig1255';

    it('1. Genera e-CF 45 con IndicadorMontoGravado=0, CDT 2%, ISC 10% y valida contra XSD oficial', () => {
      // Caso exacto:
      // Base: RD$500.00 (Servicio de Telecomunicaciones)
      // ITBIS (18%): RD$90.00
      // CDT (2%, código 002): RD$10.00
      // ISC (10%, código 004): RD$50.00
      // Total: RD$650.00
      const rawXml = xmlGenerator.generateEcfXml({
        ncfType: 'E45',
        eNcf: 'E450000000004',
        fechaEmision: new Date('2026-11-10T09:38:48'),
        fechaVencimientoSecuencia: '31-12-2028',
        rncComprador: '131880681',
        razonSocialComprador: 'MINISTERIO DE EDUCACION (MINERD)',
        indicadorMontoGravado: '0', // 0 = montos en líneas sin ITBIS incluido (neto)
        tipoIngresos: '01',
        tipoPago: '1',
        items: [
          {
            numeroLinea: 1,
            nombreItem: 'Servicio de Internet Fibra Óptica Corporativo',
            indicadorBienoServicio: '2', // Servicio
            indicadorFacturacion: '1', // 18%
            cantidad: 1,
            precioUnitario: 500.00,
            montoItem: 500.00,
            itbisRate: 0.18,
            itbisMonto: 90.00,
            tiposImpuestoAdicional: ['002', '004'],
          },
        ],
        impuestosAdicionales: [
          { tipoImpuesto: '002', tasa: 2.00, monto: 10.00 },
          { tipoImpuesto: '004', tasa: 10.00, monto: 50.00 },
        ],
      }, {
        environment: 'testecf',
        baseUrl: 'https://ecf.dgii.gov.do/testecf/',
        baseUrlRfce: 'https://fc.dgii.gov.do/testecf/',
        certPath,
        rncEmisor: '131148697',
        razonSocialEmisor: 'SUMTECH TELECOM S.R.L.',
        nombreComercial: 'SUMTECH',
        direccionEmisor: 'Av. Winston Churchill #1099, Santo Domingo',
        municipioEmisor: '010100',
        provinciaEmisor: '010000',
        correoEmisor: 'facturacion@sumtech.com.do',
        telefonoEmisor: '809-555-0199',
      });

      // Validar presencia de nodos clave
      expect(rawXml).toContain('<TipoeCF>45</TipoeCF>');
      expect(rawXml).toContain('<eNCF>E450000000004</eNCF>');
      expect(rawXml).toContain('<IndicadorMontoGravado>0</IndicadorMontoGravado>');
      expect(rawXml).toContain('<MontoGravadoTotal>500.00</MontoGravadoTotal>');
      expect(rawXml).toContain('<MontoGravadoI1>500.00</MontoGravadoI1>');
      expect(rawXml).toContain('<TotalITBIS>90.00</TotalITBIS>');
      expect(rawXml).toContain('<TotalITBIS1>90.00</TotalITBIS1>');
      expect(rawXml).toContain('<MontoImpuestoAdicional>60.00</MontoImpuestoAdicional>');
      expect(rawXml).toContain('<TipoImpuesto>002</TipoImpuesto>');
      expect(rawXml).toContain('<OtrosImpuestosAdicionales>10.00</OtrosImpuestosAdicionales>');
      expect(rawXml).toContain('<TipoImpuesto>004</TipoImpuesto>');
      expect(rawXml).toContain('<OtrosImpuestosAdicionales>50.00</OtrosImpuestosAdicionales>');
      expect(rawXml).toContain('<MontoTotal>650.00</MontoTotal>');

      // Firmar el documento
      const { signedXml, securityCode } = signerService.signXml(rawXml, certPath, certPassword);
      expect(securityCode).toBeDefined();
      expect(securityCode.length).toBe(6);

      // Validación contra esquema XSD oficial ecf-45.xsd
      const xsdResult = xsdValidator.validateEcf(signedXml, '45');
      if (!xsdResult.valid) {
        console.error('Errores XSD:', xsdResult.errors);
      }
      expect(xsdResult.valid).toBe(true);
      expect(xsdResult.errors).toEqual([]);

      // 2. Verificación criptográfica automática pre-vuelo (Problema 2)
      const cryptoResult = signerService.verifySignature(signedXml);
      expect(cryptoResult.valid).toBe(true);
      expect(cryptoResult.error).toBeUndefined();

      // 3. Verificación de Tampering (Integridad Criptográfica)
      const tamperedXml = signedXml.replace('<MontoTotal>650.00</MontoTotal>', '<MontoTotal>700.00</MontoTotal>');
      const tamperedResult = signerService.verifySignature(tamperedXml);
      expect(tamperedResult.valid).toBe(false);
      expect(tamperedResult.error).toBeDefined();

      // 4. Extracción de Metadatos y Construcción de QR (Problema 1 y 5: 0 drift)
      const meta = parseSignedEcfMetadata(signedXml);
      expect(meta.rncEmisor).toBe('131148697');
      expect(meta.rncComprador).toBe('131880681');
      expect(meta.eNcf).toBe('E450000000004');
      expect(meta.fechaEmision).toBe('10-11-2026');
      expect(meta.montoTotal).toBe('650.00');
      expect(meta.securityCode).toBe(securityCode);

      const qrUrl = buildQrUrlFromSignedXml(signedXml, 'testecf');
      expect(qrUrl).toContain('https://ecf.dgii.gov.do/testecf/consultatimbre?');
      expect(qrUrl).toContain('rncemisor=131148697');
      expect(qrUrl).toContain('rnccomprador=131880681');
      expect(qrUrl).toContain('encf=E450000000004');
      expect(qrUrl).toContain('fechaemision=10-11-2026');
      expect(qrUrl).toContain('montototal=650.00');
      // Garantía de 0 drift: el parámetro fechafirma debe ser idéntico al nodo FechaHoraFirma del XML
      const fechaFirmaEnc = encodeURIComponent(meta.fechaHoraFirma);
      expect(qrUrl).toContain(`fechafirma=${fechaFirmaEnc}`);
      expect(qrUrl).toContain(`codigoseguridad=${securityCode}`);
    });
  });
});
