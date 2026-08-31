import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DgiiB2bService } from './dgii-b2b.service';
import { DgiiXmlGeneratorService } from './dgii-xml-generator.service';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiClientService } from './dgii-client.service';
import { DgiiReceivedInvoice } from '../entities/dgii-received-invoice.entity';

describe('DgiiB2bService', () => {
  let service: DgiiB2bService;
  let receivedInvoiceRepo: any;
  let xmlGenerator: DgiiXmlGeneratorService;
  let signerService: any;
  let dgiiClient: any;

  beforeEach(async () => {
    receivedInvoiceRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'rec-1', ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    signerService = {
      signXml: jest.fn().mockImplementation((rawXml: string) => ({
        signedXml: rawXml.replace('</ARECF>', '<Signature>TEST_SIGNATURE</Signature></ARECF>'),
        securityCode: 'A1B2C3',
        signatureValue: 'TEST_SIGNATURE',
      })),
    };

    dgiiClient = {
      getConfig: jest.fn().mockReturnValue({
        environment: 'sandbox',
        rncEmisor: '131000000',
        razonSocialEmisor: 'SUMTECH TELECOM SRL',
        certPath: './certs/test.p12',
        certPassword: 'pass',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DgiiB2bService,
        DgiiXmlGeneratorService,
        { provide: getRepositoryToken(DgiiReceivedInvoice), useValue: receivedInvoiceRepo },
        { provide: DgiiSignerService, useValue: signerService },
        { provide: DgiiClientService, useValue: dgiiClient },
      ],
    }).compile();

    service = module.get<DgiiB2bService>(DgiiB2bService);
    xmlGenerator = module.get<DgiiXmlGeneratorService>(DgiiXmlGeneratorService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe generar Semilla en XML y en JSON conforme al esquema DGII', () => {
    const xmlRes = service.generarSemilla('xml');
    expect(xmlRes.xml).toContain('<SemillaModel');
    expect(xmlRes.xml).toContain('<valor>');
    expect(xmlRes.xml).toContain('<fecha>');

    const jsonRes = service.generarSemilla('json');
    expect(jsonRes.json.valor).toBeDefined();
    expect(jsonRes.json.fecha).toBeDefined();
  });

  it('debe validar certificado y emitir Token Bearer de sesión', () => {
    const tokenRes = service.validarCertificado();
    expect(tokenRes.token).toContain('SUMTECH_B2B_AUTH_TOKEN_');
    expect(tokenRes.expira).toBeDefined();
    expect(tokenRes.expedido).toBeDefined();
  });

  it('debe procesar e-CF recibido de proveedor, generar ARECF firmado y persistir en BD', async () => {
    const ecfXml = `<?xml version="1.0" encoding="utf-8"?>
<ECF>
  <Encabezado>
    <Version>1.0</Version>
    <IdDoc>
      <TipoeCF>31</TipoeCF>
      <eNCF>E310000000099</eNCF>
    </IdDoc>
    <Emisor>
      <RNCEmisor>131880681</RNCEmisor>
      <RazonSocialEmisor>PROVEEDOR FIBRA OPTICA SRL</RazonSocialEmisor>
    </Emisor>
    <Comprador>
      <RNCComprador>131000000</RNCComprador>
    </Comprador>
    <Totales>
      <MontoTotal>11800.00</MontoTotal>
      <MontoExento>0.00</MontoExento>
      <TotalITBIS>1800.00</TotalITBIS>
    </Totales>
  </Encabezado>
</ECF>`;

    const arecfSigned = await service.procesarEcfRecibido(ecfXml);

    expect(arecfSigned).toContain('<ARECF');
    expect(arecfSigned).toContain('<EstadoRespuesta>0</EstadoRespuesta>');
    expect(arecfSigned).toContain('<eNCF>E310000000099</eNCF>');
    expect(arecfSigned).toContain('<RncEmisor>131880681</RncEmisor>');
    expect(arecfSigned).toContain('<RncComprador>131000000</RncComprador>');
    expect(receivedInvoiceRepo.create).toHaveBeenCalled();
    expect(receivedInvoiceRepo.save).toHaveBeenCalled();
  });

  it('debe rechazar e-CF con estructura XML inválida y generar ARECF con EstadoRespuesta = 1', async () => {
    const invalidXml = `NO ES UN XML VALIDO <<<>>>`;

    const arecfSigned = await service.procesarEcfRecibido(invalidXml);

    expect(arecfSigned).toContain('<EstadoRespuesta>1</EstadoRespuesta>');
    expect(arecfSigned).toContain('<CodigoMotivoNoRecibido>1</CodigoMotivoNoRecibido>');
  });

  it('debe procesar Aprobación Comercial (ACECF) y retornar respuesta de confirmación', async () => {
    const acecfXml = `<?xml version="1.0" encoding="utf-8"?>
<ACECF>
  <DetalleAprobacionComercial>
    <Version>1.0</Version>
    <RNCEmisor>131880681</RNCEmisor>
    <RNCComprador>131000000</RNCComprador>
    <eNCF>E310000000099</eNCF>
    <EstadoAprobacion>1</EstadoAprobacion>
  </DetalleAprobacionComercial>
</ACECF>`;

    const respXml = await service.procesarAcecfRecibido(acecfXml);

    expect(respXml).toContain('<RespuestaAprobacionComercial');
    expect(respXml).toContain('<eNCF>E310000000099</eNCF>');
    expect(respXml).toContain('<Estado>0</Estado>');
  });
});
