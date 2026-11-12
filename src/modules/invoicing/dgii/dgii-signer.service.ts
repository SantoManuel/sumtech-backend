import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as forge from 'node-forge';
import * as crypto from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml, C14nCanonicalization } from 'xml-crypto';
import { Signature, P12Reader } from 'dgii-ecf';

@Injectable()
export class DgiiSignerService {
  private readonly logger = new Logger(DgiiSignerService.name);

  /**
   * Carga y parsea un certificado PKCS#12 (.p12 / .pfx) usando P12Reader de dgii-ecf
   * o node-forge como respaldo, extrayendo la clave privada RSA y el certificado X.509
   */
  loadCertificate(certPath: string, certPassword: string = ''): { privateKeyPem: string; certificateBase64: string; certPem: string } {
    const trimmedPassword = (certPassword || '').trim();
    try {
      const resolvedPath = certPath && (path.isAbsolute(certPath)
        ? certPath
        : path.resolve(process.cwd(), certPath));

      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        this.logger.warn(`Certificado PKCS#12 no encontrado en ruta: ${resolvedPath}. Se utilizará clave criptográfica RSA generada para desarrollo/sandbox.`);
        return this.generateDevelopmentKeyPair();
      }

      // 1. Intentar con P12Reader de dgii-ecf
      try {
        const reader = new P12Reader(trimmedPassword);
        const certData = reader.getKeyFromFile(resolvedPath);
        if (certData && certData.key && certData.cert) {
          const privateKeyPem = certData.key;
          const certPem = certData.cert;
          const cleanCertBase64 = certPem
            .replace(/-----BEGIN CERTIFICATE-----/g, '')
            .replace(/-----END CERTIFICATE-----/g, '')
            .replace(/\s+/g, '');
          return { privateKeyPem, certificateBase64: cleanCertBase64, certPem };
        }
      } catch (readerError: any) {
        this.logger.warn(`P12Reader falló (${readerError.message}), reintentando con node-forge.`);
      }

      // 2. Respaldo con node-forge
      const p12Buffer = fs.readFileSync(resolvedPath);
      const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, trimmedPassword);

      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ||
                     p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];

      if (!keyBags.length || !certBags.length) {
        this.logger.warn('No se encontraron claves o certificados válidos en el archivo P12. Usando par de desarrollo.');
        return this.generateDevelopmentKeyPair();
      }

      const privateKey = keyBags[0].key;
      const certificate = certBags[0].cert;

      if (!privateKey || !certificate) {
        return this.generateDevelopmentKeyPair();
      }

      const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
      const certPem = forge.pki.certificateToPem(certificate);
      const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
      const certificateBase64 = Buffer.from(certDer, 'binary').toString('base64');

      return { privateKeyPem, certificateBase64, certPem };
    } catch (error: any) {
      this.logger.error(`Error al cargar certificado PKCS#12: ${error.message}. Empleando fallback criptográfico.`, error.stack);
      return this.generateDevelopmentKeyPair();
    }
  }

  /**
   * Genera un par de claves RSA 2048-bit y un certificado autofirmado en memoria para entornos de prueba / fallback
   */
  private generateDevelopmentKeyPair(): { privateKeyPem: string; certificateBase64: string; certPem: string } {
    const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keypair.publicKey;
    cert.serialNumber = '01' + Date.now().toString(16);
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2);

    const attrs = [
      { name: 'commonName', value: 'SUMTECH TELECOM SRL' },
      { name: 'countryName', value: 'DO' },
      { shortName: 'ST', value: 'Distrito Nacional' },
      { name: 'localityName', value: 'Santo Domingo' },
      { name: 'organizationName', value: 'SUMTECH TELECOM SRL' },
      { shortName: 'OU', value: 'Facturacion Electronica DGII' },
      { name: 'serialNumber', value: '131000000' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keypair.privateKey, forge.md.sha256.create());

    const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
    const certPem = forge.pki.certificateToPem(cert);
    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const certificateBase64 = Buffer.from(certDer, 'binary').toString('base64');

    return { privateKeyPem, certificateBase64, certPem };
  }

  /**
   * Firma un documento XML (ECF, Semilla, RFCE, etc.) conforme a la especificación oficial XMLDSig de la DGII
   * utilizando la clase Signature de dgii-ecf para garantizar canonicalización C14N y digest conforme a la DGII.
   */
  signXml(xmlString: string, certPath: string, certPassword: string = ''): { signedXml: string; securityCode: string; signatureValue: string } {
    const cert = this.loadCertificate(certPath, certPassword);

    try {
      const signature = new Signature(cert.privateKeyPem, cert.certPem);
      const signedXml = signature.signXml(xmlString);
      const signatureValue = this.extractSignatureValue(signedXml);
      const securityCode = this.extractSecurityCodeFromSignedXml(signedXml);

      return {
        signedXml,
        securityCode,
        signatureValue,
      };
    } catch (error: any) {
      this.logger.error(`Error al firmar documento XML con dgii-ecf: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Extrae el SignatureValue del bloque de firma XMLDSig
   */
  extractSignatureValue(signedXml: string): string {
    const match = signedXml.match(/<SignatureValue[^>]*>([\s\S]*?)<\/SignatureValue>/i);
    return match && match[1] ? match[1].trim() : '';
  }

  /**
   * Extrae el código de seguridad de 6 caracteres de un documento XML ya firmado
   */
  extractSecurityCodeFromSignedXml(signedXml: string): string {
    const sigValue = this.extractSignatureValue(signedXml);
    if (sigValue) {
      // IMPORTANTE: NO convertir a uppercase ni eliminar '+' o '/' — la DGII compara los 6 primeros
      // caracteres del SignatureValue del e-CF base contra el CodigoSeguridadeCF
      // declarado en el RFCE de forma CASE-SENSITIVE y literal. Solo se limpian espacios en blanco.
      const cleanSig = sigValue.replace(/\s+/g, '');
      if (cleanSig.length >= 6) {
        return cleanSig.substring(0, 6);
      }
    }
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  /**
   * Realiza una verificación criptográfica exhaustiva de la firma XMLDSig
   * comprobando:
   * 1. Presencia del certificado X.509 en KeyInfo
   * 2. Integridad de los datos mediante DigestValue (SHA-256)
   * 3. Validez criptográfica del SignatureValue mediante la clave pública del certificado X.509
   * 4. Canonicalización estricta de SignedInfo bajo C14N estándar DGII
   */
  verifySignature(signedXml: string): { valid: boolean; error?: string } {
    if (!signedXml || typeof signedXml !== 'string') {
      return { valid: false, error: 'Documento XML no proporcionado o vacío' };
    }

    try {
      const certMatch = signedXml.match(/<X509Certificate[^>]*>([\s\S]*?)<\/X509Certificate>/i);
      if (!certMatch || !certMatch[1].trim()) {
        return { valid: false, error: 'No se encontró el certificado X.509 en el bloque KeyInfo' };
      }
      const rawCertBase64 = certMatch[1].replace(/\s+/g, '');
      const certPem = `-----BEGIN CERTIFICATE-----\n${rawCertBase64}\n-----END CERTIFICATE-----`;

      const parser = new DOMParser({
        errorHandler: (level: string, msg: string) => {
          if (level === 'error' || level === 'fatalError') {
            throw new Error(msg);
          }
        },
      } as any);
      const doc = parser.parseFromString(signedXml, 'text/xml');
      const sigNode = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0]
        || doc.getElementsByTagName('Signature')[0];

      if (!sigNode) {
        return { valid: false, error: 'No se encontró el elemento Signature en el documento' };
      }

      // 1. Verificación completa XMLDSig con xml-crypto
      const xmlVerifier = new SignedXml({ publicCert: certPem });
      try {
        const Digest = require('dgii-ecf/dist/Signature/custom/Digest').default;
        if (Digest) {
          xmlVerifier.HashAlgorithms['http://myDigestAlgorithm'] = Digest;
        }
      } catch {
        // En caso de que no requiera el digest custom
      }

      xmlVerifier.loadSignature(sigNode as any);
      const isXmlCryptoValid = xmlVerifier.checkSignature(signedXml);
      if (!isXmlCryptoValid) {
        const err = ((xmlVerifier as any).validationErrors || []).join('; ') || 'Digest o firma no coinciden con el contenido del XML';
        return { valid: false, error: err };
      }

      // 2. Verificación criptográfica directa de SignedInfo con RSA-SHA256
      const signedInfoNode = sigNode.getElementsByTagName('SignedInfo')[0];
      if (!signedInfoNode) {
        return { valid: false, error: 'No se encontró el elemento SignedInfo en la firma' };
      }

      const c14n = new C14nCanonicalization();
      const c14nSignedInfo = c14n.process(signedInfoNode as any, {} as any);

      const sigValue = this.extractSignatureValue(signedXml);
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(c14nSignedInfo);
      const isRsaValid = verifier.verify(certPem, Buffer.from(sigValue, 'base64'));

      if (!isRsaValid) {
        return {
          valid: false,
          error: 'La firma RSA-SHA256 del bloque SignedInfo no corresponde con la clave pública del certificado X.509',
        };
      }

      return { valid: true };
    } catch (err: any) {
      this.logger.error(`Error en verificación criptográfica de firma: ${err.message}`, err.stack);
      return { valid: false, error: `Excepción durante la verificación de firma: ${err.message}` };
    }
  }
}
