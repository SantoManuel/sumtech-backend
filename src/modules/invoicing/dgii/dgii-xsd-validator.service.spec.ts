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

  describe('Validación XSD oficial de documentos e-CF firmados (E32, E41, E43, E44, E46, E47)', () => {
    it('valida exitosamente un E32 (Consumo < 250k) firmado contra ecf-32.xsd', () => {
      const rawXml = generator.generateEcfXml({
        ncfType: 'E32',
        eNcf: 'E320000000001',
        razonSocialComprador: 'Juan Pérez',
        correoComprador: 'juan.perez@correo.com',
        items: [
          { numeroLinea: 1, nombreItem: 'Internet Residencial', indicadorBienoServicio: '2', indicadorFacturacion: '1', cantidad: 1, precioUnitario: 1450, montoItem: 1450 },
        ],
      });
      const { signedXml } = signer.signXml(rawXml, TEST_CERT_PATH, TEST_CERT_PASSWORD);
      const result = validator.validateEcf(signedXml, '32');
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('valida exitosamente un E41 (Proveedores Informales) firmado contra ecf-41.xsd', () => {
      const rawXml = generator.generateEcfXml({
        ncfType: 'E41',
        eNcf: 'E410000000001',
        rncComprador: '00100000001',
        razonSocialComprador: 'José Miguel Albañil',
        items: [
          { numeroLinea: 1, nombreItem: 'Trabajo de albañilería', indicadorBienoServicio: '1', indicadorFacturacion: '4', cantidad: 1, precioUnitario: 4500, montoItem: 4500 },
        ],
      });
      const { signedXml } = signer.signXml(rawXml, TEST_CERT_PATH, TEST_CERT_PASSWORD);
      const result = validator.validateEcf(signedXml, '41');
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('valida exitosamente un E43 (Gastos Menores) firmado contra ecf-43.xsd', () => {
      const rawXml = generator.generateEcfXml({
        ncfType: 'E43',
        eNcf: 'E430000000001',
        razonSocialComprador: 'Consumidor Final Gastos Menores',
        items: [
          { numeroLinea: 1, nombreItem: 'Combustible cuadrilla', indicadorBienoServicio: '1', indicadorFacturacion: '4', cantidad: 1, precioUnitario: 650, montoItem: 650 },
        ],
      });
      const { signedXml } = signer.signXml(rawXml, TEST_CERT_PATH, TEST_CERT_PASSWORD);
      const result = validator.validateEcf(signedXml, '43');
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('valida exitosamente un E44 (Regímenes Especiales - Zona Franca) firmado contra ecf-44.xsd', () => {
      const rawXml = generator.generateEcfXml({
        ncfType: 'E44',
        eNcf: 'E440000000001',
        rncComprador: '130999999',
        razonSocialComprador: 'PARQUE INDUSTRIAL ZONA FRANCA S.A.',
        items: [
          { numeroLinea: 1, nombreItem: 'Enlace Punto a Punto 1 Gbps Exento', indicadorBienoServicio: '2', indicadorFacturacion: '4', cantidad: 1, precioUnitario: 12500, montoItem: 12500 },
        ],
      });
      const { signedXml } = signer.signXml(rawXml, TEST_CERT_PATH, TEST_CERT_PASSWORD);
      const result = validator.validateEcf(signedXml, '44');
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('valida exitosamente un E46 (Pagos al Exterior - Tasa 0%) firmado contra ecf-46.xsd', () => {
      const rawXml = generator.generateEcfXml({
        ncfType: 'E46',
        eNcf: 'E460000000001',
        razonSocialComprador: 'TRANSIT PROVIDER LLC',
        items: [
          { numeroLinea: 1, nombreItem: 'Capacidad de Tránsito IP Internacional', indicadorBienoServicio: '2', indicadorFacturacion: '3', cantidad: 1, precioUnitario: 58000, montoItem: 58000 },
        ],
      });
      const { signedXml } = signer.signXml(rawXml, TEST_CERT_PATH, TEST_CERT_PASSWORD);
      const result = validator.validateEcf(signedXml, '46');
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('valida exitosamente un E47 (Exportaciones) firmado contra ecf-47.xsd', () => {
      const rawXml = generator.generateEcfXml({
        ncfType: 'E47',
        eNcf: 'E470000000001',
        rncComprador: 'EXPORT-US-991',
        razonSocialComprador: 'CARIBBEAN REGIONAL CORP',
        items: [
          { numeroLinea: 1, nombreItem: 'Exportación de Hosting y Peering', indicadorBienoServicio: '2', indicadorFacturacion: '4', cantidad: 1, precioUnitario: 42000, montoItem: 42000 },
        ],
      });
      const { signedXml } = signer.signXml(rawXml, TEST_CERT_PATH, TEST_CERT_PASSWORD);
      const result = validator.validateEcf(signedXml, '47');
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('valida exitosamente un RFCE (Resumen de Factura de Consumo) firmado contra rfce-32.xsd', () => {
      const rawXml = generator.generateRfceXml(
        'E320000000012',
        '131 148 697', // RNC con espacios para verificar sanitización
        1000.0,
        152.54,
        'WPSJZ0',
        {
          razonSocialEmisor: 'SUMTECH TELECOM S.R.L.',
          razonSocialComprador: 'Consumidor Final',
          montoGravadoTotal: 847.46,
          montoGravadoI1: 847.46,
          totalItbis1: 152.54,
        },
      );
      const { signedXml } = signer.signXml(rawXml, TEST_CERT_PATH, TEST_CERT_PASSWORD);
      const result = validator.validateRfce(signedXml);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  });
});

