import { Test, TestingModule } from '@nestjs/testing';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiXmlGeneratorService } from './dgii-xml-generator.service';
import { DgiiXsdValidatorService } from './dgii-xsd-validator.service';

/**
 * Guarda de confiabilidad: un e-CF 45 (RNC 131148697, CDT 2% + ISC 10%, total
 * RD$650 — caso oficial del set de pruebas DGII) fue rechazado una vez en
 * producción por "no cumple el esquema XSD" (ver memoria
 * sumtech_dgii_xsd_preflight_rejection_no_retry), pero al re-validar el XML
 * firmado exacto fuera de línea, sí pasaba. Como `DgiiXsdValidatorService` es
 * un singleton que cachea el `xmljs.Document` del esquema por nombre de
 * archivo (`schemaCache`) y lo reutiliza en cada llamada a `validate()`, la
 * sospecha era un efecto secundario del addon nativo (libxmljs2/libxml2) al
 * reusar ese objeto de esquema entre validaciones repetidas/intercaladas.
 * Este test corre muchas validaciones seguidas, alternando dos tipos de
 * documento para forzar que el cache rote entre ecf-45.xsd y ecf-31.xsd, tal
 * como ocurre con tráfico real. Si esto empieza a fallar de forma
 * intermitente, el síntoma reportado por el usuario es reproducible y hay que
 * dejar de cachear el `xmljs.Document` del esquema (parsear uno nuevo por
 * llamada) en vez de seguir sospechando de los datos de la factura.
 */
describe('Confiabilidad del validador XSD bajo uso repetido del esquema cacheado', () => {
  let signerService: DgiiSignerService;
  let xmlGenerator: DgiiXmlGeneratorService;
  let xsdValidator: DgiiXsdValidatorService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DgiiSignerService, DgiiXmlGeneratorService, DgiiXsdValidatorService],
    }).compile();
    signerService = module.get(DgiiSignerService);
    xmlGenerator = module.get(DgiiXmlGeneratorService);
    xsdValidator = module.get(DgiiXsdValidatorService);
  });

  it('valida 60 veces seguidas sin fallos intermitentes, intercalando otros tipos de documento', () => {
    const certPath = './certs/22817887_identity.p12';
    const certPassword = process.env.DGII_CERT_PASSWORD || 'hagmauhig1255';

    const buildE45 = () =>
      xmlGenerator.generateEcfXml(
        {
          ncfType: 'E45',
          eNcf: 'E450000000004',
          fechaEmision: new Date(),
          fechaVencimientoSecuencia: '31-12-2028',
          rncComprador: '131880681',
          razonSocialComprador: 'MINISTERIO DE EDUCACION (MINERD)',
          indicadorMontoGravado: '0',
          tipoIngresos: '01',
          tipoPago: '1',
          items: [
            {
              numeroLinea: 1,
              nombreItem: 'Servicio de Internet Fibra Óptica Corporativo',
              indicadorBienoServicio: '2',
              indicadorFacturacion: '1',
              cantidad: 1,
              precioUnitario: 500.0,
              montoItem: 500.0,
              itbisRate: 0.18,
              itbisMonto: 90.0,
              tiposImpuestoAdicional: ['002', '004'],
            },
          ],
          impuestosAdicionales: [
            { tipoImpuesto: '002', tasa: 2.0, monto: 10.0 },
            { tipoImpuesto: '004', tasa: 10.0, monto: 50.0 },
          ],
        },
        {
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
        },
      );

    const buildE31 = () =>
      xmlGenerator.generateEcfXml(
        {
          ncfType: 'E31',
          eNcf: 'E310000000099',
          fechaEmision: new Date(),
          fechaVencimientoSecuencia: '31-12-2028',
          rncComprador: '131880681',
          razonSocialComprador: 'CLIENTE DE PRUEBA',
          items: [
            {
              numeroLinea: 1,
              nombreItem: 'Fibra residencial',
              indicadorBienoServicio: '2',
              indicadorFacturacion: '1',
              cantidad: 1,
              precioUnitario: 1000.0,
              montoItem: 1000.0,
              itbisRate: 0.18,
              itbisMonto: 180.0,
            },
          ],
        },
        {
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
        },
      );

    let failures = 0;
    const failureDetails: any[] = [];
    const ITERATIONS = 60;

    for (let i = 0; i < ITERATIONS; i++) {
      // Intercalar con otro tipo de documento cada 3 iteraciones, para forzar
      // que el cache de esquemas (Map por nombre de archivo) alterne entre
      // ecf-45.xsd y ecf-31.xsd, como pasaría en producción con tráfico real.
      if (i % 3 === 0) {
        const rawE31 = buildE31();
        const signedE31 = signerService.signXml(rawE31, certPath, certPassword);
        xsdValidator.validateEcf(signedE31.signedXml, '31');
      }

      const rawXml = buildE45();
      const { signedXml } = signerService.signXml(rawXml, certPath, certPassword);
      const result = xsdValidator.validateEcf(signedXml, '45');
      if (!result.valid) {
        failures++;
        failureDetails.push({ iteration: i, errors: result.errors });
      }
    }

    if (failures > 0) {
      console.error(`FALLOS INTERMITENTES: ${failures}/${ITERATIONS}`, JSON.stringify(failureDetails, null, 2));
    }
    expect(failures).toBe(0);
  });
});
