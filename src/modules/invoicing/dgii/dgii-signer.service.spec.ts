import { Test, TestingModule } from '@nestjs/testing';
import { DgiiSignerService } from './dgii-signer.service';

describe('DgiiSignerService', () => {
  let service: DgiiSignerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DgiiSignerService],
    }).compile();

    service = module.get<DgiiSignerService>(DgiiSignerService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe firmar digitalmente un XML e-CF y generar bloque ds:Signature con código de seguridad', () => {
    const rawXml = 
      `<ECF>` +
        `<Encabezado>` +
          `<Version>1.0</Version>` +
          `<IdDoc><TipoeCF>31</TipoeCF><eNCF>E3100000001</eNCF></IdDoc>` +
          `<Emisor><RNCEmisor>131000000</RNCEmisor><RazonSocialEmisor>SUMTECH TELECOM SRL</RazonSocialEmisor></Emisor>` +
          `<Totales><MontoTotal>1180.00</MontoTotal></Totales>` +
        `</Encabezado>` +
        `<FechaHoraFirma>30-08-2026 12:00:00</FechaHoraFirma>` +
      `</ECF>`;

    const { signedXml, securityCode, signatureValue } = service.signXml(rawXml, './certs/22817887_identity.p12', 'hagmauhig1255');

    expect(signedXml).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    expect(signedXml).toContain('<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>');
    expect(signedXml).toContain('<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>');
    expect(signedXml).toContain('<SignatureValue>');
    expect(signedXml).toContain('<X509Certificate>');
    expect(securityCode).toBeDefined();
    expect(securityCode.length).toBe(6);
    expect(signatureValue).toBeDefined();
  });

  it('debe extraer el código de seguridad de 6 dígitos de un XML firmado existente', () => {
    const mockSigned = `<ECF><Signature><SignatureValue>ABC123XYZ9999==</SignatureValue></Signature></ECF>`;
    const code = service.extractSecurityCodeFromSignedXml(mockSigned);
    expect(code).toBe('ABC123');
  });

  describe('verifySignature', () => {
    const rawXml =
      `<ECF>` +
        `<Encabezado>` +
          `<Version>1.0</Version>` +
          `<IdDoc><TipoeCF>45</TipoeCF><eNCF>E450000000004</eNCF></IdDoc>` +
          `<Emisor><RNCEmisor>131148697</RNCEmisor><RazonSocialEmisor>SUMTECH TELECOM SRL</RazonSocialEmisor></Emisor>` +
          `<Totales><MontoTotal>650.00</MontoTotal></Totales>` +
        `</Encabezado>` +
        `<FechaHoraFirma>10-11-2026 09:38:48</FechaHoraFirma>` +
      `</ECF>`;

    it('debe verificar criptográficamente como válida una firma recién generada', () => {
      const { signedXml } = service.signXml(rawXml, './certs/22817887_identity.p12', 'hagmauhig1255');
      const result = service.verifySignature(signedXml);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('debe detectar alteración del contenido (tampering) y rechazar la firma', () => {
      const { signedXml } = service.signXml(rawXml, './certs/22817887_identity.p12', 'hagmauhig1255');
      // Alteramos un monto en el XML firmado
      const tamperedXml = signedXml.replace('<MontoTotal>650.00</MontoTotal>', '<MontoTotal>999.00</MontoTotal>');
      const result = service.verifySignature(tamperedXml);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('debe rechazar un XML sin bloque de firma', () => {
      const result = service.verifySignature(rawXml);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No se encontró el certificado X.509');
    });
  });
});
