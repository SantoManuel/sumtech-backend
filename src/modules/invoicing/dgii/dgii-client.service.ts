import { Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { DgiiConfig, DEFAULT_DGII_CONFIG } from './dgii-config.interface';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiXsdValidatorService } from './dgii-xsd-validator.service';
import { ecfTipoDoc } from './dgii-xml-generator.service';
import { DgiiCertificationRun } from './entities/dgii-certification-run.entity';
import { CompanyService } from '../../company/company.service';

export interface DgiiSendResult {
  trackId: string;
  status: 'ACCEPTED' | 'PENDING' | 'REJECTED' | 'CONTINGENCY';
  securityCode: string;
  qrCodeUrl: string;
  responseMessage: string;
  timestamp: Date;
  signedXml: string;
  validationErrors?: string[];
}

export interface ConnectionDiagnosticResult {
  environment: string;
  baseUrl: string;
  dnsResolution: boolean;
  latencyMs: number;
  tlsHandshake: boolean;
  certificateLoaded: boolean;
  seedRetrieved: boolean;
  signatureVerified: boolean;
  tokenObtained: boolean;
  tokenExpiresAt?: string;
  rawResponse?: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  message: string;
}

@Injectable()
export class DgiiClientService implements OnModuleInit {
  private readonly logger = new Logger(DgiiClientService.name);
  private config: DgiiConfig = { ...DEFAULT_DGII_CONFIG };
  private token: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(
    private readonly signerService: DgiiSignerService,
    private readonly xsdValidator: DgiiXsdValidatorService,
    @InjectRepository(DgiiCertificationRun)
    private readonly runRepository: Repository<DgiiCertificationRun>,
    @Optional() private readonly companyService?: CompanyService,
  ) {
    this.initFromEnv();
  }

  async onModuleInit() {
    if (this.companyService) {
      try {
        await this.syncFromCompanyService();
      } catch (err: any) {
        this.logger.warn(`No se pudo sincronizar configuración corporativa inicial: ${err.message}`);
      }
    }
  }

  @OnEvent('company.tenant.updated')
  @OnEvent('company.tenant.default_changed')
  async handleCompanyConfigChanged() {
    await this.syncFromCompanyService();
  }

  public async syncFromCompanyService() {
    if (!this.companyService) return;
    try {
      const fiscal = await this.companyService.getCompanyFiscalInfo();
      this.config = {
        ...this.config,
        rncEmisor: fiscal.rnc || this.config.rncEmisor,
        razonSocialEmisor: fiscal.razonSocial || this.config.razonSocialEmisor,
        nombreComercial: fiscal.nombreComercial || this.config.nombreComercial,
        direccionEmisor: fiscal.direccion || this.config.direccionEmisor,
        municipioEmisor: fiscal.municipio || this.config.municipioEmisor,
        provinciaEmisor: fiscal.provincia || this.config.provinciaEmisor,
        correoEmisor: fiscal.correo || this.config.correoEmisor,
        telefonoEmisor: fiscal.telefono || this.config.telefonoEmisor,
        webSite: fiscal.website || this.config.webSite,
      };
      this.logger.log(`Configuración fiscal sincronizada desde BD para RNC: ${this.config.rncEmisor}`);
    } catch (err: any) {
      this.logger.warn(`Error al sincronizar datos fiscales desde CompanyService: ${err.message}`);
    }
  }

  private initFromEnv() {
    this.config = {
      environment: (process.env.DGII_ENVIRONMENT as any) || 'testecf',
      baseUrl: process.env.DGII_AUTH_URL || 'https://ecf.dgii.gov.do/testecf/',
      baseUrlRfce: 'https://fc.dgii.gov.do/testecf/',
      certPath: process.env.DGII_CERT_PATH || './certs/22817887_identity.p12',
      certPassword: process.env.DGII_CERT_PASSWORD || 'hagmauhig1255',
      rncEmisor: process.env.DGII_RNC_EMISOR || '131000000',
      razonSocialEmisor: 'SUMTECH TELECOM S.R.L.',
      nombreComercial: 'SUMTECH FIBRA & TV',
      direccionEmisor: 'Av. 27 de Febrero esq. Winston Churchill, Santo Domingo, D.N.',
      correoEmisor: 'facturacion@sumtech.com.do',
      telefonoEmisor: '809-555-0199',
      webSite: 'https://sumtech.com.do',
    };
  }

  public getConfig(): DgiiConfig {
    return { ...this.config };
  }

  public async updateConfig(newConfig: Partial<DgiiConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.token = null;
    this.tokenExpiresAt = null;

    if (this.companyService) {
      try {
        const defaultTenant = await this.companyService.getDefaultTenant();
        await this.companyService.update(defaultTenant.id, {
          rnc: newConfig.rncEmisor,
          companyName: newConfig.razonSocialEmisor,
          commercialName: newConfig.nombreComercial,
          address: newConfig.direccionEmisor,
          phone: newConfig.telefonoEmisor,
          email: newConfig.correoEmisor,
          website: newConfig.webSite,
        });
      } catch (err: any) {
        this.logger.warn(`Error persistiendo datos fiscales en tenant_config: ${err.message}`);
      }
    }
  }

  /**
   * Obtiene un cliente Axios preconfigurado. `baseUrlOverride` se usa para
   * RFCE, que la DGII expone en un host distinto (`fc.dgii.gov.do`,
   * `config.baseUrlRfce`) aunque reutiliza el mismo token Bearer emitido
   * contra el host principal.
   */
  private getHttpClient(baseUrlOverride?: string): AxiosInstance {
    let baseUrl = baseUrlOverride || this.config.baseUrl;
    if (!baseUrl.endsWith('/')) baseUrl += '/';

    // Aplica SOLO a este cliente HTTP hacia la DGII (nunca globalmente): un
    // proveedor certificado de referencia (TarbiatAdmin.Dgii) desactiva la
    // validación del certificado TLS del servidor de la DGII en dos
    // transportes independientes, señal de un problema real de cadena de
    // certificados del lado de la DGII. Se deja apagado por defecto — solo se
    // activa explícitamente si un envío real revienta por TLS.
    const insecure = process.env.DGII_TLS_INSECURE === 'true';
    if (insecure) {
      this.logger.warn('DGII_TLS_INSECURE=true: validación del certificado TLS de la DGII desactivada para este cliente. Usar solo si un envío real falla por la cadena de certificados de la DGII.');
    }

    return axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
        'X-RncEmisor': this.config.rncEmisor,
      },
      httpsAgent: insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined,
    });
  }

  /**
   * Garantiza la obtención y vigencia de un Token Bearer autenticado por la DGII
   */
  async ensureToken(): Promise<string> {
    if (this.token && this.tokenExpiresAt && new Date() < this.tokenExpiresAt) {
      return this.token;
    }

    if (this.config.environment === 'sandbox') {
      this.token = `SBX_TOKEN_${Date.now()}`;
      this.tokenExpiresAt = new Date(Date.now() + 3600 * 1000);
      return this.token;
    }

    try {
      const client = this.getHttpClient();
      this.logger.log(`Solicitando semilla de autenticación a la DGII (${this.config.baseUrl})...`);
      
      // 1. Obtener Semilla
      const seedResponse = await client.get('Autenticacion/api/Autenticacion/Semilla');
      const seedXml = seedResponse.data;

      // 2. Firmar Semilla con Certificado Digital
      const { signedXml } = this.signerService.signXml(seedXml, this.config.certPath, this.config.certPassword);

      // 3. Validar Semilla y obtener Token
      const FormData = require('form-data');
      const form = new FormData();
      form.append('xml', Buffer.from(signedXml, 'utf8'), {
        filename: 'semilla.xml',
        contentType: 'text/xml',
      });

      const tokenResponse = await client.post('Autenticacion/api/Autenticacion/ValidarSemilla', form, {
        headers: form.getHeaders(),
      });

      const data = tokenResponse.data;
      if (!data?.token) {
        throw new Error('La DGII no devolvió un token de sesión válido.');
      }

      this.token = data.token as string;
      this.tokenExpiresAt = data.expira ? new Date(data.expira) : new Date(Date.now() + 3500 * 1000);
      this.logger.log(`Autenticación DGII exitosa. Token obtenido válido hasta: ${this.tokenExpiresAt.toISOString()}`);
      return this.token;
    } catch (error: any) {
      this.logger.warn(`No fue posible autenticar con los servidores web de la DGII: ${error.message}. Activando modo sandbox/contingencia.`);
      this.token = `SBX_FALLBACK_${Date.now()}`;
      this.tokenExpiresAt = new Date(Date.now() + 3600 * 1000);
      return this.token;
    }
  }

  /**
   * Ejecuta un diagnóstico integral de conexión, latencia, certificado y semilla con los servidores DGII
   */
  async testConnectionDiagnostic(): Promise<ConnectionDiagnosticResult> {
    const startTime = Date.now();
    let dnsResolution = false;
    let tlsHandshake = false;
    let certificateLoaded = false;
    let seedRetrieved = false;
    let signatureVerified = false;
    let tokenObtained = false;
    let rawResponse = '';
    let tokenExp: string | undefined;

    try {
      // 1. Validar carga del certificado
      const cert = this.signerService.loadCertificate(this.config.certPath, this.config.certPassword || '');
      certificateLoaded = !!(cert.privateKeyPem && cert.certificateBase64);

      if (this.config.environment === 'sandbox') {
        const latency = Date.now() - startTime;
        return {
          environment: this.config.environment,
          baseUrl: this.config.baseUrl,
          dnsResolution: true,
          latencyMs: Math.max(12, latency),
          tlsHandshake: true,
          certificateLoaded: true,
          seedRetrieved: true,
          signatureVerified: true,
          tokenObtained: true,
          tokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          status: 'ONLINE',
          message: 'Ambiente Sandbox / Simulador Local Operativo al 100%',
        };
      }

      const client = this.getHttpClient();
      
      // 2. Solicitud Semilla
      dnsResolution = true;
      const seedResponse = await client.get('Autenticacion/api/Autenticacion/Semilla');
      tlsHandshake = true;
      const seedXml = seedResponse.data;
      seedRetrieved = typeof seedXml === 'string' && seedXml.includes('<SemillaModel');

      // 3. Firma Semilla
      const { signedXml } = this.signerService.signXml(seedXml, this.config.certPath, this.config.certPassword);
      signatureVerified = !!signedXml && signedXml.includes('<Signature');

      // 4. Token DGII
      const FormData = require('form-data');
      const form = new FormData();
      form.append('xml', Buffer.from(signedXml, 'utf8'), {
        filename: 'semilla.xml',
        contentType: 'text/xml',
      });

      const tokenResponse = await client.post('Autenticacion/api/Autenticacion/ValidarSemilla', form, {
        headers: form.getHeaders(),
      });

      const data = tokenResponse.data;
      tokenObtained = !!data?.token;
      tokenExp = data?.expira;
      rawResponse = JSON.stringify(data);

      const latencyMs = Date.now() - startTime;

      return {
        environment: this.config.environment,
        baseUrl: this.config.baseUrl,
        dnsResolution,
        latencyMs,
        tlsHandshake,
        certificateLoaded,
        seedRetrieved,
        signatureVerified,
        tokenObtained,
        tokenExpiresAt: tokenExp,
        rawResponse,
        status: tokenObtained ? 'ONLINE' : 'DEGRADED',
        message: tokenObtained
          ? `Conexión oficial establecida exitosamente con DGII (${this.config.environment.toUpperCase()}) en ${latencyMs}ms`
          : 'Conectividad parcial: Semilla obtenida pero fallo en validación de token',
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      return {
        environment: this.config.environment,
        baseUrl: this.config.baseUrl,
        dnsResolution,
        latencyMs,
        tlsHandshake,
        certificateLoaded,
        seedRetrieved,
        signatureVerified,
        tokenObtained: false,
        rawResponse: err.message,
        status: 'OFFLINE',
        message: `Fallo de conexión con DGII: ${err.message}`,
      };
    }
  }

  /**
   * Construye la URL del Código QR según las normativas oficiales de la DGII
   */
  generateQrCodeUrl(
    eNcf: string,
    montoTotal: number,
    securityCode: string,
    fechaEmision: Date = new Date(),
    rncComprador?: string,
  ): string {
    const env = this.config.environment === 'ecf' ? 'ecf' : this.config.environment === 'certecf' ? 'certecf' : 'testecf';
    const fechaEmiStr = `${String(fechaEmision.getDate()).padStart(2, '0')}-${String(fechaEmision.getMonth() + 1).padStart(2, '0')}-${fechaEmision.getFullYear()}`;
    const fechaFirStr = `${fechaEmiStr} ${String(fechaEmision.getHours()).padStart(2, '0')}:${String(fechaEmision.getMinutes()).padStart(2, '0')}:${String(fechaEmision.getSeconds()).padStart(2, '0')}`;
    const montoStr = Number(montoTotal || 0).toFixed(2);

    const isConsumoMenor = eNcf.startsWith('E32') && montoTotal < 250000;

    if (isConsumoMenor) {
      return `https://fc.dgii.gov.do/${env}/consultatimbrefc?rncemisor=${encodeURIComponent(this.config.rncEmisor)}&encf=${encodeURIComponent(eNcf)}&montototal=${encodeURIComponent(montoStr)}&codigoseguridad=${encodeURIComponent(securityCode)}`;
    }

    let compradorQuery = '';
    const cleanRnc = (rncComprador || '').replace(/\D/g, '');
    if (cleanRnc && !eNcf.startsWith('E43') && !eNcf.startsWith('E47')) {
      compradorQuery = `&rnccomprador=${encodeURIComponent(cleanRnc)}`;
    }

    return `https://ecf.dgii.gov.do/${env}/consultatimbre?rncemisor=${encodeURIComponent(this.config.rncEmisor)}${compradorQuery}&encf=${encodeURIComponent(eNcf)}&fechaemision=${encodeURIComponent(fechaEmiStr)}&montototal=${encodeURIComponent(montoStr)}&fechafirma=${encodeURIComponent(fechaFirStr)}&codigoseguridad=${encodeURIComponent(securityCode)}`;
  }

  /**
   * Envía un e-CF firmado digitalmente a la DGII y retorna el resultado del timbrado.
   * `ncfType` (ej. 'E31', 'B01') se usa para elegir el XSD correcto — la
   * validación corre DESPUÉS de firmar porque el esquema exige el nodo de
   * firma al final del documento (ver DgiiXsdValidatorService).
   */
  async submitEcf(
    rawXml: string,
    eNcf: string,
    montoTotal: number,
    ncfType: string,
    rncComprador?: string,
  ): Promise<DgiiSendResult> {
    // 1. Firmar el documento XML
    const { signedXml, securityCode } = this.signerService.signXml(rawXml, this.config.certPath, this.config.certPassword);

    // 1.b Validar contra el XSD oficial de la DGII — un documento mal armado
    // no debe siquiera intentar enviarse (ni consumir un intento de red/e-NCF).
    const tipoDoc = ecfTipoDoc(ncfType);
    const validation = this.xsdValidator.validateEcf(signedXml, tipoDoc);
    if (!validation.valid) {
      this.logger.error(`e-CF ${eNcf} (tipo ${tipoDoc}) no pasó la validación XSD: ${validation.errors.join(' | ')}`);
      return {
        trackId: `TRK-XSD-ERR-${Date.now()}`,
        status: 'REJECTED',
        securityCode,
        qrCodeUrl: this.generateQrCodeUrl(eNcf, montoTotal, securityCode, new Date(), rncComprador),
        responseMessage: 'El documento no cumple el esquema XSD oficial de la DGII — no fue enviado.',
        timestamp: new Date(),
        signedXml,
        validationErrors: validation.errors,
      };
    }

    // 2. Generar URL QR
    const qrCodeUrl = this.generateQrCodeUrl(eNcf, montoTotal, securityCode, new Date(), rncComprador);

    // 3. Enviar a DGII si no estamos en sandbox puro
    if (this.config.environment !== 'sandbox') {
      try {
        const token = await this.ensureToken();
        const client = this.getHttpClient();
        const FormData = require('form-data');
        const form = new FormData();
        const fileName = `${this.config.rncEmisor}${eNcf}.xml`;

        form.append('xml', Buffer.from(signedXml, 'utf8'), {
          filename: fileName,
          contentType: 'text/xml',
        });

        const sendRes = await client.post('recepcion/api/facturaselectronicas', form, {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${token}`,
          },
        });

        const data = sendRes.data;
        const trackId = data?.trackId || `TRK-DGII-${Date.now()}`;
        const status = data?.estado === 'RECHAZADO' ? 'REJECTED' : 'ACCEPTED';
        const responseMessage = data?.mensaje || 'Comprobante Fiscal Electrónico Timbrado y Aceptado por DGII';

        return {
          trackId,
          status,
          securityCode,
          qrCodeUrl,
          responseMessage,
          timestamp: new Date(),
          signedXml,
        };
      } catch (err: any) {
        this.logger.warn(`Fallo en el envío online a DGII (${err.message}). Registrando factura en modo CONTINGENCIA.`);
        return {
          trackId: `TRK-CONTINGENCY-${Date.now()}`,
          status: 'CONTINGENCY',
          securityCode,
          qrCodeUrl,
          responseMessage: 'Comprobante emitido en Contingencia por indisponibilidad de enlace DGII',
          timestamp: new Date(),
          signedXml,
        };
      }
    }

    // Modo Sandbox Simulador
    return {
      trackId: `TRK-SBX-${Date.now()}`,
      status: 'ACCEPTED',
      securityCode,
      qrCodeUrl,
      responseMessage: 'Comprobante Fiscal Electrónico Simulado y Certificado en Sandbox DGII',
      timestamp: new Date(),
      signedXml,
    };
  }

  /**
   * Envía un Resumen de Factura de Consumo Electrónica (RFCE, e-CF tipo 32
   * < RD$250,000) — la DGII lo recibe en un HOST DISTINTO al del resto de
   * documentos (`fc.dgii.gov.do`, `config.baseUrlRfce`, ruta
   * `recepcionfc/api/recepcion/ecf`), aunque reutiliza el mismo token Bearer.
   * Antes de este método, las pruebas de RFCE se enviaban por error a través
   * de `submitEcf` (el host y la ruta de `ecf.dgii.gov.do` para e-CF regular),
   * algo que la DGII real habría rechazado.
   */
  async submitRfce(rawXml: string, eNcf: string, montoTotal: number): Promise<DgiiSendResult> {
    const { signedXml, securityCode } = this.signerService.signXml(rawXml, this.config.certPath, this.config.certPassword);

    const validation = this.xsdValidator.validateRfce(signedXml);
    if (!validation.valid) {
      this.logger.error(`RFCE ${eNcf} no pasó la validación XSD: ${validation.errors.join(' | ')}`);
      return {
        trackId: `TRK-XSD-ERR-${Date.now()}`,
        status: 'REJECTED',
        securityCode,
        qrCodeUrl: this.generateQrCodeUrl(eNcf, montoTotal, securityCode, new Date()),
        responseMessage: 'El resumen RFCE no cumple el esquema XSD oficial de la DGII — no fue enviado.',
        timestamp: new Date(),
        signedXml,
        validationErrors: validation.errors,
      };
    }

    const qrCodeUrl = this.generateQrCodeUrl(eNcf, montoTotal, securityCode, new Date());

    if (this.config.environment !== 'sandbox') {
      try {
        const token = await this.ensureToken();
        const client = this.getHttpClient(this.config.baseUrlRfce);
        const FormData = require('form-data');
        const form = new FormData();
        form.append('xml', Buffer.from(signedXml, 'utf8'), {
          filename: `${this.config.rncEmisor}${eNcf}.xml`,
          contentType: 'text/xml',
        });

        const sendRes = await client.post('recepcionfc/api/recepcion/ecf', form, {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${token}`,
          },
        });

        const data = sendRes.data;
        const trackId = data?.trackId || `TRK-RFCE-${Date.now()}`;
        const status = data?.estado === 'RECHAZADO' ? 'REJECTED' : 'ACCEPTED';
        const responseMessage = data?.mensaje || 'Resumen RFCE recibido y aceptado por DGII';

        return { trackId, status, securityCode, qrCodeUrl, responseMessage, timestamp: new Date(), signedXml };
      } catch (err: any) {
        this.logger.warn(`Fallo en el envío online de RFCE a DGII (${err.message}). Registrando en modo CONTINGENCIA.`);
        return {
          trackId: `TRK-CONTINGENCY-RFCE-${Date.now()}`,
          status: 'CONTINGENCY',
          securityCode,
          qrCodeUrl,
          responseMessage: 'Resumen RFCE emitido en Contingencia por indisponibilidad de enlace DGII',
          timestamp: new Date(),
          signedXml,
        };
      }
    }

    return {
      trackId: `TRK-SBX-RFCE-${Date.now()}`,
      status: 'ACCEPTED',
      securityCode,
      qrCodeUrl,
      responseMessage: 'Resumen RFCE Simulado y Certificado en Sandbox DGII',
      timestamp: new Date(),
      signedXml,
    };
  }

  /**
   * Envía una Aprobación Comercial (ACECF) firmada digitalmente a la DGII.
   * A diferencia del e-CF, el XSD de la ACECF trae la firma como opcional
   * (`xs:any minOccurs="0"`), así que aquí se valida el contenido SIN firmar
   * primero — más fácil de depurar un rechazo — y se firma después.
   */
  async submitCommercialApproval(rawXml: string, eNcf: string): Promise<any> {
    const validation = this.xsdValidator.validateAcecf(rawXml);
    if (!validation.valid) {
      this.logger.error(`ACECF de ${eNcf} no pasó la validación XSD: ${validation.errors.join(' | ')}`);
      return {
        trackId: `TRK-ACE-XSD-ERR-${Date.now()}`,
        estado: 'ERROR',
        mensaje: 'El documento ACECF no cumple el esquema XSD oficial de la DGII — no fue enviado.',
        validationErrors: validation.errors,
      };
    }

    const { signedXml } = this.signerService.signXml(rawXml, this.config.certPath, this.config.certPassword);

    if (this.config.environment === 'sandbox') {
      return {
        trackId: `TRK-ACE-SBX-${Date.now()}`,
        estado: 'ACEPTADO',
        mensaje: `Aprobación Comercial de comprobante ${eNcf} procesada exitosamente en Sandbox`,
        signedXml,
      };
    }

    try {
      const token = await this.ensureToken();
      const client = this.getHttpClient();
      const FormData = require('form-data');
      const form = new FormData();
      form.append('xml', Buffer.from(signedXml, 'utf8'), {
        filename: `ACECF_${this.config.rncEmisor}_${eNcf}.xml`,
        contentType: 'text/xml',
      });

      const response = await client.post('recepcion/api/aprobacioncomercial', form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
      });

      return {
        trackId: response.data?.trackId || `TRK-ACE-${Date.now()}`,
        estado: response.data?.estado || 'PROCESADO',
        mensaje: response.data?.mensaje || 'Aprobación Comercial enviada y aceptada por DGII',
        signedXml,
      };
    } catch (err: any) {
      this.logger.error(`Error enviando Aprobación Comercial para ${eNcf}: ${err.message}`);
      return {
        trackId: `TRK-ACE-ERR-${Date.now()}`,
        estado: 'ERROR',
        mensaje: err.message,
        signedXml,
      };
    }
  }

  /**
   * Envía una Anulación de Secuencias (ANECF) firmada digitalmente a la DGII
   */
  async submitSequenceVoiding(rawXml: string): Promise<any> {
    const { signedXml } = this.signerService.signXml(rawXml, this.config.certPath, this.config.certPassword);

    if (this.config.environment === 'sandbox') {
      return {
        trackId: `TRK-ANU-SBX-${Date.now()}`,
        estado: 'ACEPTADO',
        mensaje: 'Anulación de secuencias e-NCF procesada exitosamente en Sandbox',
        signedXml,
      };
    }

    try {
      const token = await this.ensureToken();
      const client = this.getHttpClient();
      const FormData = require('form-data');
      const form = new FormData();
      form.append('xml', Buffer.from(signedXml, 'utf8'), {
        filename: `ANECF_${this.config.rncEmisor}_${Date.now()}.xml`,
        contentType: 'text/xml',
      });

      const response = await client.post('recepcion/api/anulacion', form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
      });

      return {
        trackId: response.data?.trackId || `TRK-ANU-${Date.now()}`,
        estado: response.data?.estado || 'PROCESADO',
        mensaje: response.data?.mensaje || 'Anulación de secuencias e-NCF enviada y aceptada por DGII',
        signedXml,
      };
    } catch (err: any) {
      this.logger.error(`Error enviando Anulación de Secuencias: ${err.message}`);
      return {
        trackId: `TRK-ANU-ERR-${Date.now()}`,
        estado: 'ERROR',
        mensaje: err.message,
        signedXml,
      };
    }
  }

  /**
   * Consulta el estado de procesamiento de un TrackId en la DGII
   */
  async queryTrackIdStatus(trackId: string): Promise<any> {
    if (this.config.environment === 'sandbox' || trackId.startsWith('TRK-SBX') || trackId.startsWith('TRK-CONTINGENCY')) {
      // El resultado ya no se inventa como "ACEPTADO" fijo: se consulta el
      // historial persistido (DgiiCertificationRun) para devolver el estado
      // que REALMENTE se guardó al ejecutar ese caso — un caso rechazado en
      // sandbox debe seguir reportándose como rechazado al consultarlo después.
      const run = await this.runRepository.findOne({ where: { trackId }, order: { executedAt: 'DESC' } });
      if (run) {
        return {
          trackId,
          estado: run.status === 'ACCEPTED' ? 'ACEPTADO' : run.status === 'CONTINGENCY' ? 'CONTINGENCIA' : run.status === 'REJECTED' ? 'RECHAZADO' : 'EN_PROCESO',
          codigo: run.status === 'ACCEPTED' ? '0' : '1',
          mensaje: run.responseMessage || 'Comprobante procesado (Sandbox / Contingencia)',
        };
      }
      return {
        trackId,
        estado: 'NO_ENCONTRADO',
        codigo: '404',
        mensaje: 'No hay ningún registro persistido para este TrackId en el historial de certificación.',
      };
    }

    try {
      const token = await this.ensureToken();
      const client = this.getHttpClient();
      const response = await client.get(`consultaresultado/api/consultas/estado?trackid=${encodeURIComponent(trackId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (error: any) {
      this.logger.error(`Error al consultar TrackId ${trackId}: ${error.message}`);
      return {
        trackId,
        estado: 'EN_PROCESO',
        mensaje: error.message,
      };
    }
  }
}
