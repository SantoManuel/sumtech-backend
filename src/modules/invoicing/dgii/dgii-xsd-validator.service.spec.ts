import { DgiiXsdValidatorService } from './dgii-xsd-validator.service';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiXmlGeneratorService, EcfGenerationInput, AcecfGenerationInput } from './dgii-xml-generator.service';

const TEST_CERT_PATH = './certs/22817887_identity.p12';
const TEST_CERT_PASSWORD = 'hagmauhig1255';

describe('DgiiXsdValidatorService', () => {
  let validator: DgiiXsdValidatorService;
  let signer: DgiiSignerService;
  let generator: DgiiXmlGeneratorService;

  beforeEach(() => {
    validator = new DgiiXsdValidatorService();
    signer = new DgiiSignerService();
    generator = new DgiiXmlGeneratorService();
  });

  it('acepta un e-CF real (generado + firmado) contra el XSD oficial de la DGII', () => {
    const input: EcfGenerationInput = {
      ncfType: 'E31',
      eNcf: 'E310000000003',
      rncComprador: '131880681',
      razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03',
      tipoPago: '1',
      items: [
        { numeroLinea: 1, nombreItem: 'Servicio de Internet Dedicado', indicadorBienoServicio: '2', indicadorFacturacion: '1', cantidad: 1, precioUnitario: 6000, montoItem: 6000 },
      ],
    };
    const rawXml = generator.generateEcfXml(input);
    const { signedXml } = signer.signXml(rawXml, TEST_CERT_PATH, TEST_CERT_PASSWORD);

    const result = validator.validateEcf(signedXml, '31');

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rechaza un e-CF sin firmar (el XSD exige el nodo de firma al final)', () => {
    const input: EcfGenerationInput = {
      ncfType: 'E31',
      eNcf: 'E310000000003',
      razonSocialComprador: 'Consumidor Final',
      items: [{ numeroLinea: 1, nombreItem: 'Servicio', indicadorBienoServicio: '2', indicadorFacturacion: '1', cantidad: 1, precioUnitario: 100, montoItem: 100 }],
    };
    const rawXml = generator.generateEcfXml(input);

    const result = validator.validateEcf(rawXml, '31');

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rechaza un e-CF con e-NCF vacío (violación de tipo, no solo de la firma)', () => {
    const malformedXml = `<ECF><Encabezado><Version>1.0</Version><IdDoc><TipoeCF>31</TipoeCF><eNCF></eNCF></IdDoc></Encabezado></ECF>`;
    const result = validator.validateEcf(malformedXml, '31');
    expect(result.valid).toBe(false);
  });

  it('devuelve error controlado para un TipoeCF sin esquema registrado', () => {
    const result = validator.validateEcf('<ECF/>', '99');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('99');
  });

  it('acepta una ACECF real generada, sin firmar (la firma es opcional en su XSD)', () => {
    const input: AcecfGenerationInput = {
      rncEmisor: '131000000',
      rncComprador: '130999999',
      eNcf: 'E310000000003',
      fechaEmisionEcf: new Date('2026-01-10T00:00:00'),
      montoTotalEcf: 7080,
      estadoAprobacion: 1,
      comentario: 'Servicio recibido conforme',
      fechaAprobacion: new Date('2026-01-15T10:00:00'),
    };
    const rawXml = generator.generateAcecfXml(input);

    const result = validator.validateAcecf(rawXml);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
