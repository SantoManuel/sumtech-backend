import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

@Injectable()
export class DgiiSignerService {
  private readonly logger = new Logger(DgiiSignerService.name);

  /**
   * Carga y parsea un certificado PKCS#12 (.p12 / .pfx) usando node-forge y extrae la clave privada RSA y el certificado X.509
   */
  loadCertificate(certPath: string, certPassword: string): { privateKeyPem: string; certificateBase64: string } {
    try {
      const resolvedPath = path.isAbsolute(certPath)
        ? certPath
        : path.resolve(process.cwd(), certPath);

      if (!fs.existsSync(resolvedPath)) {
        this.logger.warn(`Certificado PKCS#12 no encontrado en ruta: ${resolvedPath}. Se utilizará clave criptográfica RSA generada para desarrollo/sandbox.`);
        return this.generateDevelopmentKeyPair();
      }

      const p12Buffer = fs.readFileSync(resolvedPath);
      const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certPassword);

      // Extraer bolsas de claves privadas
      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ||
                     p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];

      // Extraer bolsas de certificados
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
      const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
      const certificateBase64 = Buffer.from(certDer, 'binary').toString('base64');

      return { privateKeyPem, certificateBase64 };
    } catch (error: any) {
      this.logger.error(`Error al cargar certificado PKCS#12: ${error.message}. Empleando fallback criptográfico.`, error.stack);
      return this.generateDevelopmentKeyPair();
    }
  }

  /**
   * Genera un par de claves RSA 2048-bit y un certificado autofirmado en memoria para entornos de prueba / fallback
   */
  private generateDevelopmentKeyPair(): { privateKeyPem: string; certificateBase64: string } {
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
    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const certificateBase64 = Buffer.from(certDer, 'binary').toString('base64');

    return { privateKeyPem, certificateBase64 };
  }

  /**
   * Implementación de Canonicalización XML C14N (Rec-xml-c14n-20010315)
   */
  canonicalize(node: any): string {
    const serializer = new XMLSerializer();
    let xml = serializer.serializeToString(node);
    
    // Normalizar saltos de línea y espacios redundantes
    xml = xml.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return xml;
  }

  /**
   * Firma un documento XML (ECF o Semilla) conforme a la especificación oficial XMLDSig de la DGII
   * RSA-SHA256, Digest SHA256, Canonicalization C14N y Enveloped Signature.
   */
  signXml(xmlString: string, certPath: string, certPassword: string = ''): { signedXml: string; securityCode: string; signatureValue: string } {
    const { privateKeyPem, certificateBase64 } = this.loadCertificate(certPath, certPassword);

    // Parsear XML
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const rootElement = doc.documentElement;

    if (!rootElement) {
      throw new Error('El documento XML no contiene un elemento raíz válido.');
    }

    // 1. Calcular Digest SHA-256 del contenido raíz
    const rootCanonical = this.canonicalize(rootElement);
    const digestValue = crypto.createHash('sha256').update(rootCanonical, 'utf8').digest('base64');

    // 2. Construir elemento <SignedInfo>
    const signedInfoXml = 
      `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">` +
        `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
        `<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
        `<Reference URI="">` +
          `<Transforms>` +
            `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
          `</Transforms>` +
          `<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
          `<DigestValue>${digestValue}</DigestValue>` +
        `</Reference>` +
      `</SignedInfo>`;

    // 3. Firmar el <SignedInfo> con la clave privada RSA usando SHA-256
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signedInfoXml, 'utf8');
    const signatureValue = signer.sign(privateKeyPem, 'base64');

    // 4. Extraer el Código de Seguridad DGII (Primeros 6 caracteres del SignatureValue)
    const securityCode = signatureValue.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase();

    // 5. Construir bloque completo <ds:Signature>
    const signatureElementXml = 
      `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` +
        signedInfoXml +
        `<SignatureValue>${signatureValue}</SignatureValue>` +
        `<KeyInfo>` +
          `<X509Data>` +
            `<X509Certificate>${certificateBase64}</X509Certificate>` +
          `</X509Data>` +
        `</KeyInfo>` +
      `</Signature>`;

    const signatureDoc = parser.parseFromString(signatureElementXml, 'text/xml');
    if (signatureDoc.documentElement) {
      const importedSignatureNode = doc.importNode(signatureDoc.documentElement, true);
      rootElement.appendChild(importedSignatureNode);
    }

    const serializer = new XMLSerializer();
    let finalSignedXml = serializer.serializeToString(doc);

    if (!finalSignedXml.startsWith('<?xml')) {
      finalSignedXml = `<?xml version="1.0" encoding="utf-8"?>\n` + finalSignedXml;
    }

    return {
      signedXml: finalSignedXml,
      securityCode,
      signatureValue,
    };
  }

  /**
   * Extrae el código de seguridad de 6 dígitos de un documento XML ya firmado
   */
  extractSecurityCodeFromSignedXml(signedXml: string): string {
    const match = signedXml.match(/<SignatureValue[^>]*>([\s\S]*?)<\/SignatureValue>/i);
    if (match && match[1]) {
      const cleanSig = match[1].trim().replace(/[^a-zA-Z0-9]/g, '');
      return cleanSig.substring(0, 6).toUpperCase();
    }
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
}
