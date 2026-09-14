import { Test, TestingModule } from '@nestjs/testing';
import { DgiiXmlGeneratorService, EcfGenerationInput, ecfTipoDoc, usesNcfExpiryDate, UNIDAD_MEDIDA_UND } from './dgii-xml-generator.service';

describe('DgiiXmlGeneratorService', () => {
  let service: DgiiXmlGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DgiiXmlGeneratorService],
    }).compile();

    service = module.get<DgiiXmlGeneratorService>(DgiiXmlGeneratorService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe generar un XML e-CF E31 (Crédito Fiscal) válido con estructura oficial DGII', () => {
    const input: EcfGenerationInput = {
      ncfType: 'E31',
      eNcf: 'E3100000001',
      rncComprador: '130000001',
      razonSocialComprador: 'EMPRESA CLIENTE S.A.',
      correoComprador: 'cliente@empresa.com',
      direccionComprador: 'Av. Winston Churchill #100',
      items: [
        {
          numeroLinea: 1,
          nombreItem: 'Plan Fibra Simétrica 300 Mbps',
          indicadorBienoServicio: '2',
          indicadorFacturacion: '1',
          cantidad: 1,
          precioUnitario: 1800.0,
          montoItem: 1800.0,
        },
        {
          numeroLinea: 2,
          nombreItem: 'Router ONT Wi-Fi 6 Gigabit',
          indicadorBienoServicio: '1',
          indicadorFacturacion: '1',
          cantidad: 1,
          precioUnitario: 2500.0,
          montoItem: 2500.0,
        },
      ],
    };

    const xml = service.generateEcfXml(input);

    expect(xml).toContain('<ECF>');
    expect(xml).toContain('<Version>1.0</Version>');
    expect(xml).toContain('<TipoeCF>31</TipoeCF>');
    expect(xml).toContain('<eNCF>E3100000001</eNCF>');
    expect(xml).toContain('<FechaVencimientoSecuencia>');
    expect(xml).toContain('<RNCComprador>130000001</RNCComprador>');
    expect(xml).toContain('<RazonSocialComprador>EMPRESA CLIENTE S.A.</RazonSocialComprador>');
    expect(xml).toContain('<MontoGravadoTotal>4300.00</MontoGravadoTotal>');
    expect(xml).toContain('<TotalITBIS>774.00</TotalITBIS>');
    expect(xml).toContain('<MontoTotal>5074.00</MontoTotal>');
    expect(xml).toContain('<FechaHoraFirma>');
  });

  it('debe generar un XML e-CF E32 (Consumidor Final) sin requerir RNC comprador obligatorio', () => {
    const input: EcfGenerationInput = {
      ncfType: 'E32',
      eNcf: 'E3200000005',
      razonSocialComprador: 'Juan Perez',
      items: [
        {
          numeroLinea: 1,
          nombreItem: 'Plan Residencial Dúo 100 Mbps + TV',
          indicadorBienoServicio: '2',
          indicadorFacturacion: '1',
          cantidad: 1,
          precioUnitario: 1450.0,
          montoItem: 1450.0,
        },
      ],
    };

    const xml = service.generateEcfXml(input);

    expect(xml).toContain('<TipoeCF>32</TipoeCF>');
    expect(xml).toContain('<eNCF>E3200000005</eNCF>');
    expect(xml).not.toContain('<FechaVencimientoSecuencia>');
    expect(xml).toContain('<RazonSocialComprador>Juan Perez</RazonSocialComprador>');
    expect(xml).toContain('<MontoTotal>1711.00</MontoTotal>');
  });

  it('no incluye ImpuestosAdicionales ni TablaImpuestoAdicional cuando la factura no tiene impuestos adicionales', () => {
    const input: EcfGenerationInput = {
      ncfType: 'E32',
      eNcf: 'E3200000006',
      razonSocialComprador: 'Consumidor Final',
      items: [
        {
          numeroLinea: 1,
          nombreItem: 'Plan Fibra 50 Mbps',
          indicadorBienoServicio: '2',
          indicadorFacturacion: '1',
          cantidad: 1,
          precioUnitario: 1250.0,
          montoItem: 1250.0,
        },
      ],
    };

    const xml = service.generateEcfXml(input);

    expect(xml).not.toContain('<ImpuestosAdicionales>');
    expect(xml).not.toContain('<TablaImpuestoAdicional>');
    expect(xml).not.toContain('<MontoImpuestoAdicional>');
  });

  it('declara el CDT (código DGII 002) como ImpuestoAdicional y lo suma al MontoTotal', () => {
    // Fibra 100 Mbps: subtotal 2195, ITBIS 18% = 395.10, CDT 2% = 43.90 -> total 2634.00
    const input: EcfGenerationInput = {
      ncfType: 'E32',
      eNcf: 'E3200000007',
      razonSocialComprador: 'Juan Perez',
      items: [
        {
          numeroLinea: 1,
          nombreItem: 'Combo Dúo 150 Mbps + TV HD - Servicio de septiembre de 2026',
          indicadorBienoServicio: '2',
          indicadorFacturacion: '1',
          cantidad: 1,
          precioUnitario: 2195.0,
          montoItem: 2195.0,
          itbisRate: 0.18,
          itbisMonto: 395.1,
          tiposImpuestoAdicional: ['002'],
        },
      ],
      impuestosAdicionales: [{ tipoImpuesto: '002', tasa: 2, monto: 43.9 }],
    };

    const xml = service.generateEcfXml(input);

    expect(xml).toContain('<MontoImpuestoAdicional>43.90</MontoImpuestoAdicional>');
    expect(xml).toContain(
      '<ImpuestosAdicionales><ImpuestoAdicional><TipoImpuesto>002</TipoImpuesto><TasaImpuestoAdicional>2.00</TasaImpuestoAdicional><OtrosImpuestosAdicionales>43.90</OtrosImpuestosAdicionales></ImpuestoAdicional></ImpuestosAdicionales>',
    );
    expect(xml).toContain('<TablaImpuestoAdicional><ImpuestoAdicional><TipoImpuesto>002</TipoImpuesto></ImpuestoAdicional></TablaImpuestoAdicional>');
    expect(xml).toContain('<MontoTotal>2634.00</MontoTotal>');

    // El bloque TablaImpuestoAdicional del ítem debe ir antes de MontoItem (orden del XSD oficial)
    const itemBlockStart = xml.indexOf('<Item>');
    const tablaIndex = xml.indexOf('<TablaImpuestoAdicional>', itemBlockStart);
    const montoItemIndex = xml.indexOf('<MontoItem>', itemBlockStart);
    expect(tablaIndex).toBeGreaterThan(itemBlockStart);
    expect(tablaIndex).toBeLessThan(montoItemIndex);

    // El bloque ImpuestosAdicionales de Totales debe ir antes de MontoTotal (orden del XSD oficial)
    const totalesStart = xml.indexOf('<Totales>');
    const impuestosAdicionalesIndex = xml.indexOf('<ImpuestosAdicionales>', totalesStart);
    const montoTotalIndex = xml.indexOf('<MontoTotal>', totalesStart);
    expect(impuestosAdicionalesIndex).toBeGreaterThan(totalesStart);
    expect(impuestosAdicionalesIndex).toBeLessThan(montoTotalIndex);
  });

  it('soporta múltiples impuestos adicionales sumándolos correctamente al MontoImpuestoAdicional y al MontoTotal', () => {
    const input: EcfGenerationInput = {
      ncfType: 'E32',
      eNcf: 'E3200000008',
      razonSocialComprador: 'Consumidor Final',
      items: [
        {
          numeroLinea: 1,
          nombreItem: 'Servicio Combo',
          indicadorBienoServicio: '2',
          indicadorFacturacion: '4',
          cantidad: 1,
          precioUnitario: 1000.0,
          montoItem: 1000.0,
          tiposImpuestoAdicional: ['002', '004'],
        },
      ],
      impuestosAdicionales: [
        { tipoImpuesto: '002', tasa: 2, monto: 20 },
        { tipoImpuesto: '004', tasa: 10, monto: 100 },
      ],
    };

    const xml = service.generateEcfXml(input);

    expect(xml).toContain('<MontoImpuestoAdicional>120.00</MontoImpuestoAdicional>');
    expect(xml).toContain('<MontoTotal>1120.00</MontoTotal>');
    expect(xml).toContain('<TipoImpuesto>002</TipoImpuesto>');
    expect(xml).toContain('<TipoImpuesto>004</TipoImpuesto>');
  });

  describe('UnidadMedida (código UND=43, solo para bienes)', () => {
    it('incluye <UnidadMedida> entre CantidadItem y PrecioUnitarioItem cuando el ítem lo declara', () => {
      const input: EcfGenerationInput = {
        ncfType: 'E32',
        eNcf: 'E3200000009',
        razonSocialComprador: 'Juan Perez',
        items: [
          {
            numeroLinea: 1,
            nombreItem: 'Router ONT Wi-Fi 6',
            indicadorBienoServicio: '1',
            indicadorFacturacion: '1',
            cantidad: 1,
            precioUnitario: 2500.0,
            montoItem: 2500.0,
            unidadMedida: UNIDAD_MEDIDA_UND,
          },
        ],
      };

      const xml = service.generateEcfXml(input);

      expect(xml).toContain(`<UnidadMedida>${UNIDAD_MEDIDA_UND}</UnidadMedida>`);
      const cantidadIndex = xml.indexOf('<CantidadItem>');
      const unidadIndex = xml.indexOf('<UnidadMedida>');
      const precioIndex = xml.indexOf('<PrecioUnitarioItem>');
      expect(cantidadIndex).toBeLessThan(unidadIndex);
      expect(unidadIndex).toBeLessThan(precioIndex);
    });

    it('omite <UnidadMedida> cuando el ítem no lo declara (ej. servicios, sin código DGII dedicado)', () => {
      const input: EcfGenerationInput = {
        ncfType: 'E32',
        eNcf: 'E3200000010',
        razonSocialComprador: 'Juan Perez',
        items: [
          {
            numeroLinea: 1,
            nombreItem: 'Plan Fibra 100 Mbps',
            indicadorBienoServicio: '2',
            indicadorFacturacion: '1',
            cantidad: 1,
            precioUnitario: 1500.0,
            montoItem: 1500.0,
          },
        ],
      };

      const xml = service.generateEcfXml(input);
      expect(xml).not.toContain('<UnidadMedida>');
    });
  });

  describe('Nota de Crédito (E34)', () => {
    const baseInput: EcfGenerationInput = {
      ncfType: 'E34',
      eNcf: 'E340000000001',
      razonSocialComprador: 'Juan Perez',
      ncfModificado: 'E310000001701',
      fechaNcfModificado: '05-08-2026',
      codigoModificacion: '1',
      razonModificacion: 'Anula el NCF modificado',
      items: [
        {
          numeroLinea: 1,
          nombreItem: 'Fibra 100 Mbps',
          indicadorBienoServicio: '2',
          indicadorFacturacion: '1',
          cantidad: 1,
          precioUnitario: 1000,
          montoItem: 1000,
        },
      ],
    };

    it('usa el indicadorNotaCredito explícito ("0" = emitida dentro de 30 días) en vez del default hardcodeado', () => {
      const xml = service.generateEcfXml({ ...baseInput, indicadorNotaCredito: '0' });
      expect(xml).toContain('<IndicadorNotaCredito>0</IndicadorNotaCredito>');
    });

    it('usa el indicadorNotaCredito explícito ("1" = emitida después de 30 días)', () => {
      const xml = service.generateEcfXml({ ...baseInput, indicadorNotaCredito: '1' });
      expect(xml).toContain('<IndicadorNotaCredito>1</IndicadorNotaCredito>');
    });

    it('cae al default "1" si no se provee indicadorNotaCredito (compatibilidad con el generador de certificación DGII)', () => {
      const xml = service.generateEcfXml(baseInput);
      expect(xml).toContain('<IndicadorNotaCredito>1</IndicadorNotaCredito>');
    });

    it('usa la fechaNcfModificado real provista en vez del default hardcodeado 01-01-2026', () => {
      const xml = service.generateEcfXml(baseInput);
      expect(xml).toContain('<FechaNCFModificado>05-08-2026</FechaNCFModificado>');
      expect(xml).not.toContain('<FechaNCFModificado>01-01-2026</FechaNCFModificado>');
    });

    it('incluye el bloque InformacionReferencia completo (NCFModificado/CodigoModificacion/RazonModificacion)', () => {
      const xml = service.generateEcfXml(baseInput);
      expect(xml).toContain('<NCFModificado>E310000001701</NCFModificado>');
      expect(xml).toContain('<CodigoModificacion>1</CodigoModificacion>');
      expect(xml).toContain('<RazonModificacion>Anula el NCF modificado</RazonModificacion>');
    });
  });

  describe('helpers ecfTipoDoc / usesNcfExpiryDate', () => {
    it('normaliza B01/B02 a los códigos numéricos 31/32', () => {
      expect(ecfTipoDoc('B01')).toBe('31');
      expect(ecfTipoDoc('B02')).toBe('32');
      expect(ecfTipoDoc('E31')).toBe('31');
      expect(ecfTipoDoc('E44')).toBe('44');
    });

    it('FechaVencimientoSecuencia solo aplica fuera de Consumo (E32/B02) y Nota de Crédito (E34)', () => {
      expect(usesNcfExpiryDate('E31')).toBe(true);
      expect(usesNcfExpiryDate('B01')).toBe(true);
      expect(usesNcfExpiryDate('E44')).toBe(true);
      expect(usesNcfExpiryDate('E32')).toBe(false);
      expect(usesNcfExpiryDate('B02')).toBe(false);
      expect(usesNcfExpiryDate('E34')).toBe(false);
    });
  });
});
