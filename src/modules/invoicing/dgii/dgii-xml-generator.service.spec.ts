import { Test, TestingModule } from '@nestjs/testing';
import { DgiiXmlGeneratorService, EcfGenerationInput } from './dgii-xml-generator.service';

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
});
