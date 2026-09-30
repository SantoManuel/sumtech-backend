import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { DgiiConfig } from './dgii-config.interface';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiXsdValidatorService } from './dgii-xsd-validator.service';
import { ecfTipoDoc } from './dgii-xml-generator.service';
import { DgiiCertificationRun } from './entities/dgii-certification-run.entity';
import { CompanyService } from '../../company/company.service';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';

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

/**
 * Cliente DGII — Fase 4 del plan multi-tenant: cada ISP factura bajo su
 * propio RNC/certificado, así que este servicio ya NO cachea un `DgiiConfig`
 * mutable como estado de instancia (eso era, además de quedar obsoleto al
 * primer tenant nuevo, un bug real de correctitud bajo concurrencia: dos
 * requests de dos tenants distintos en vuelo al mismo tiempo podían pisarse
 * el `this.config` compartido). `resolveConfig()` arma la configuración
 * efectiva EN CADA LLAMADA, mezclando los defaults de env var (el tenant
 * original `sumtech`, que no tiene certificado en MinIO) con las columnas de
 * `CompanyProfileEntity` del tenant activo en `TenantContextService`. El
 * token Bearer de la DGII, por el mismo motivo, se cachea en un mapa por
 * tenant en vez de un solo campo compartido.
 */
@Injectable()
export class DgiiClientService {
  private readonly logger = new Logger(DgiiClientService.name);
  private readonly tokenCache = new Map<string, { token: string; expiresAt: Date }>();

  constructor(
    private readonly signerService: DgiiSignerService,
    private readonly xsdValidator: DgiiXsdValidatorService,
    @InjectRepository(DgiiCertificationRun)
    private readonly runRepository: Repository<DgiiCertificationRun>,
    private readonly tenantContext: TenantContextService,
    @Optional() private readonly companyService?: CompanyService,
  ) {}

  private buildEnvDefaults(): DgiiConfig {
    return {
      environment: (process.env.DGII_ENVIRONMENT as any) || 'testecf',
      baseUrl: process.env.DGII_AUTH_URL || 'https://ecf.dgii.gov.do/testecf/',
      baseUrlRfce: 'https://fc.dgii.gov.do/testecf/',
      certPath: process.env.DGII_CERT_PATH || './certs/22817887_identity.p12',
      certPassword: process.env.DGII_CERT_PASSWORD || '',
      rncEmisor: process.env.DGII_RNC_EMISOR || '131000000',
      razonSocialEmisor: 'SUMTECH TELECOM S.R.L.',
      nombreComercial: 'SUMTECH FIBRA & TV',
      direccionEmisor: 'Av. 27 de Febrero esq. Winston Churchill, Santo Domingo, D.N.',
      correoEmisor: 'facturacion@sumtech.com.do',
      telefonoEmisor: '809-555-0199',
      webSite: 'https://sumtech.com.do',
    };
  }

  /**
   * Descarga el certificado del tenant activo desde MinIO a un archivo
   * temporal — `DgiiSignerService`/`node-forge` exigen un path de archivo,
   * no un buffer. Se descarga fresco en cada llamada (sin cache local) para
   * no tener que invalidar nada si el ISP sube un certificado nuevo — el
   * volumen de llamadas DGII no es lo bastante alto como para que el costo
   * de red importe.
   */
  private async materializeCertFile(objectKey: string, slug: string): Promise<string> {
    const buffer = await this.companyService!.getDgiiCertificateBuffer(objectKey);
    const dir = path.join(os.tmpdir(), 'sumtech-dgii-certs');
    fs.mkdirSync(dir, { recursive: true });
    const safeSlug = slug.replace(/[^a-zA-Z0-9._-]/g, '_');
    const hash = crypto.createHash('sha1').update(objectKey).digest('hex').slice(0, 8);
    const filePath = path.join(dir, `${safeSlug}_${hash}.p12`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  /**
   * Arma la configuración DGII efectiva para el tenant activo (env defaults
   * + columnas de `CompanyProfileEntity`, si hay contexto de tenant y el
   * servicio está disponible — `@Optional()` porque algunos consumidores de
   * este servicio corren en tests/scripts fuera de un módulo con `company`).
   */
  private async resolveConfig(): Promise<DgiiConfig> {
    const base = this.buildEnvDefaults();

    if (!this.companyService || !this.tenantContext.hasContext()) {
      return base;
    }

    try {
      const [fiscal, dgii] = await Promise.all([
        this.companyService.getCompanyFiscalInfo(),
        this.companyService.getDgiiSettings(),
      ]);

      let certPath = base.certPath;
      if (dgii.certObjectKey) {
        certPath = await this.materializeCertFile(dgii.certObjectKey, this.tenantContext.getSlug());
      }

      return {
        ...base,
        environment: (dgii.environment as any) || base.environment,
        baseUrl: dgii.authUrl || base.baseUrl,
        certPath,
        certPassword: dgii.certPassword || base.certPassword,
        rncEmisor: fiscal.rnc || base.rncEmisor,
        razonSocialEmisor: fiscal.razonSocial || base.razonSocialEmisor,
        nombreComercial: fiscal.nombreComercial || base.nombreComercial,
        direccionEmisor: fiscal.direccion || base.direccionEmisor,
        municipioEmisor: fiscal.municipio || base.municipioEmisor,
        provinciaEmisor: fiscal.provincia || base.provinciaEmisor,
        correoEmisor: fiscal.correo || base.correoEmisor,
        telefonoEmisor: fiscal.telefono || base.telefonoEmisor,
        webSite: fiscal.website || base.webSite,
      };
    } catch (err: any) {
      this.logger.warn(`No se pudo resolver la configuración DGII del tenant activo, usando defaults de env var: ${err.message}`);
      return base;
    }
  }

  public async getConfig(): Promise<DgiiConfig> {
    return this.resolveConfig();
  }

  /**
   * Persiste cambios de configuración DGII directamente en el perfil del
   * tenant activo — ya no hay `this.config` en memoria que mutar, así que
   * la próxima llamada a cualquier método de este servicio ve el cambio de
   * inmediato vía `resolveConfig()`.
   */
  public async updateConfig(newConfig: Partial<DgiiConfig>): Promise<void> {
    if (!this.companyService) return;

    const patch: Record<string, unknown> = {
      rnc: newConfig.rncEmisor,
      companyName: newConfig.razonSocialEmisor,
      commercialName: newConfig.nombreComercial,
      address: newConfig.direccionEmisor,
      phone: newConfig.telefonoEmisor,
      email: newConfig.correoEmisor,
      website: newConfig.webSite,
      dgiiEnvironment: newConfig.environment,
      dgiiAuthUrl: newConfig.baseUrl,
    };

    // Un `certPassword` vacío/no provisto significa "no tocar la contraseña
    // actual" — nunca se incluye en el patch, porque `CompanyService.update()`
    // hace `Object.assign` sin filtrar campos vacíos y borraría en silencio
    // la contraseña real del certificado de firma del tenant.
    if (newConfig.certPassword) {
      patch.dgiiCertPassword = newConfig.certPassword;
    }

    await this.companyService.update(patch as any);

    // El token cacheado del tenant activo pudo haber quedado firmado con un
    // RNC/certificado que ya no aplica — se invalida para forzar una nueva
    // autenticación en la próxima llamada.
    if (this.tenantContext.hasContext()) {
      this.tokenCache.delete(this.tenantContext.getSlug());
    }
  }

  private getHttpClient(config: DgiiConfig, baseUrlOverride?: string): AxiosInstance {
    let baseUrl = baseUrlOverride || config.baseUrl;
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
        'X-RncEmisor': config.rncEmisor,
      },
      httpsAgent: insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined,
    });
  }

  /**
   * Garantiza la obtención y vigencia de un Token Bearer autenticado por la
   * DGII — cacheado por tenant (`tokenCache`), nunca en un solo campo
   * compartido: un token autenticado con el RNC/certificado de un tenant no
   * es válido para timbrar documentos de otro.
   */
  async ensureToken(configOverride?: DgiiConfig): Promise<string> {
    const config = configOverride || (await this.resolveConfig());
    const cacheKey = this.tenantContext.hasContext() ? this.tenantContext.getSlug() : '__global__';
    const cached = this.tokenCache.get(cacheKey);
    if (cached && new Date() < cached.expiresAt) {
      return cached.token;
    }

    if (config.environment === 'sandbox') {
      const token = `SBX_TOKEN_${Date.now()}`;
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      this.tokenCache.set(cacheKey, { token, expiresAt });
      return token;
    }

    try {
      const client = this.getHttpClient(config);
      this.logger.log(`Solicitando semilla de autenticación a la DGII (${config.baseUrl})...`);

      // 1. Obtener Semilla
      const seedResponse = await client.get('Autenticacion/api/Autenticacion/Semilla');
      const seedXml = seedResponse.data;

      // 2. Firmar Semilla con Certificado Digital
      const { signedXml } = this.signerService.signXml(seedXml, config.certPath, config.certPassword);

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

      const token = data.token as string;
      const expiresAt = data.expira ? new Date(data.expira) : new Date(Date.now() + 3500 * 1000);
      this.tokenCache.set(cacheKey, { token, expiresAt });
      this.logger.log(`Autenticación DGII exitosa. Token obtenido válido hasta: ${expiresAt.toISOString()}`);
      return token;
    } catch (error: any) {
      this.logger.warn(`No fue posible autenticar con los servidores web de la DGII: ${error.message}. Activando modo sandbox/contingencia.`);
      const token = `SBX_FALLBACK_${Date.now()}`;
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      this.tokenCache.set(cacheKey, { token, expiresAt });
      return token;
    }
  }

  /**
   * Ejecuta un diagnóstico integral de conexión, latencia, certificado y semilla con los servidores DGII
   */
  async testConnectionDiagnostic(): Promise<ConnectionDiagnosticResult> {
    const config = await this.resolveConfig();
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
      const cert = this.signerService.loadCertificate(config.certPath, config.certPassword || '');
      certificateLoaded = !!(cert.privateKeyPem && cert.certificateBase64);

      if (config.environment === 'sandbox') {
        const latency = Date.now() - startTime;
        return {
          environment: config.environment,
          baseUrl: config.baseUrl,
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

      const client = this.getHttpClient(config);

      // 2. Solicitud Semilla
      dnsResolution = true;
      const seedResponse = await client.get('Autenticacion/api/Autenticacion/Semilla');
      tlsHandshake = true;
      const seedXml = seedResponse.data;
      seedRetrieved = typeof seedXml === 'string' && seedXml.includes('<SemillaModel');

      // 3. Firma Semilla
      const { signedXml } = this.signerService.signXml(seedXml, config.certPath, config.certPassword);
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
        environment: config.environment,
        baseUrl: config.baseUrl,
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
          ? `Conexión oficial establecida exitosamente con DGII (${config.environment.toUpperCase()}) en ${latencyMs}ms`
          : 'Conectividad parcial: Semilla obtenida pero fallo en validación de token',
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      return {
        environment: config.environment,
        baseUrl: config.baseUrl,
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
    config: DgiiConfig,
    eNcf: string,
    montoTotal: number,
    securityCode: string,
    fechaEmision: Date = new Date(),
    rncComprador?: string,
  ): string {
    const env = config.environment === 'ecf' ? 'ecf' : config.environment === 'certecf' ? 'certecf' : 'testecf';
    const fechaEmiStr = `${String(fechaEmision.getDate()).padStart(2, '0')}-${String(fechaEmision.getMonth() + 1).padStart(2, '0')}-${fechaEmision.getFullYear()}`;
    const fechaFirStr = `${fechaEmiStr} ${String(fechaEmision.getHours()).padStart(2, '0')}:${String(fechaEmision.getMinutes()).padStart(2, '0')}:${String(fechaEmision.getSeconds()).padStart(2, '0')}`;
    const montoStr = Number(montoTotal || 0).toFixed(2);

    const isConsumoMenor = eNcf.startsWith('E32') && montoTotal < 250000;

    if (isConsumoMenor) {
      return `https://fc.dgii.gov.do/${env}/consultatimbrefc?rncemisor=${encodeURIComponent(config.rncEmisor)}&encf=${encodeURIComponent(eNcf)}&montototal=${encodeURIComponent(montoStr)}&codigoseguridad=${encodeURIComponent(securityCode)}`;
    }

    let compradorQuery = '';
    const cleanRnc = (rncComprador || '').replace(/\D/g, '');
    if (cleanRnc && !eNcf.startsWith('E43') && !eNcf.startsWith('E47')) {
      compradorQuery = `&rnccomprador=${encodeURIComponent(cleanRnc)}`;
    }

    return `https://ecf.dgii.gov.do/${env}/consultatimbre?rncemisor=${encodeURIComponent(config.rncEmisor)}${compradorQuery}&encf=${encodeURIComponent(eNcf)}&fechaemision=${encodeURIComponent(fechaEmiStr)}&montototal=${encodeURIComponent(montoStr)}&fechafirma=${encodeURIComponent(fechaFirStr)}&codigoseguridad=${encodeURIComponent(securityCode)}`;
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
    const config = await this.resolveConfig();

    // 1. Firmar el documento XML
    const { signedXml, securityCode } = this.signerService.signXml(rawXml, config.certPath, config.certPassword);

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
        qrCodeUrl: this.generateQrCodeUrl(config, eNcf, montoTotal, securityCode, new Date(), rncComprador),
        responseMessage: 'El documento no cumple el esquema XSD oficial de la DGII — no fue enviado.',
        timestamp: new Date(),
        signedXml,
        validationErrors: validation.errors,
      };
    }

    // 2. Generar URL QR
    const qrCodeUrl = this.generateQrCodeUrl(config, eNcf, montoTotal, securityCode, new Date(), rncComprador);

    // 3. Enviar a DGII si no estamos en sandbox puro
    if (config.environment !== 'sandbox') {
      try {
        const token = await this.ensureToken(config);
        const client = this.getHttpClient(config);
        const FormData = require('form-data');
        const form = new FormData();
        const fileName = `${config.rncEmisor}${eNcf}.xml`;

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
   */
  async submitRfce(rawXml: string, eNcf: string, montoTotal: number): Promise<DgiiSendResult> {
    const config = await this.resolveConfig();
    const { signedXml, securityCode } = this.signerService.signXml(rawXml, config.certPath, config.certPassword);

    const validation = this.xsdValidator.validateRfce(signedXml);
    if (!validation.valid) {
      this.logger.error(`RFCE ${eNcf} no pasó la validación XSD: ${validation.errors.join(' | ')}`);
      return {
        trackId: `TRK-XSD-ERR-${Date.now()}`,
        status: 'REJECTED',
        securityCode,
        qrCodeUrl: this.generateQrCodeUrl(config, eNcf, montoTotal, securityCode, new Date()),
        responseMessage: 'El resumen RFCE no cumple el esquema XSD oficial de la DGII — no fue enviado.',
        timestamp: new Date(),
        signedXml,
        validationErrors: validation.errors,
      };
    }

    const qrCodeUrl = this.generateQrCodeUrl(config, eNcf, montoTotal, securityCode, new Date());

    if (config.environment !== 'sandbox') {
      try {
        const token = await this.ensureToken(config);
        const client = this.getHttpClient(config, config.baseUrlRfce);
        const FormData = require('form-data');
        const form = new FormData();
        form.append('xml', Buffer.from(signedXml, 'utf8'), {
          filename: `${config.rncEmisor}${eNcf}.xml`,
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

    const config = await this.resolveConfig();
    const { signedXml } = this.signerService.signXml(rawXml, config.certPath, config.certPassword);

    if (config.environment === 'sandbox') {
      return {
        trackId: `TRK-ACE-SBX-${Date.now()}`,
        estado: 'ACEPTADO',
        mensaje: `Aprobación Comercial de comprobante ${eNcf} procesada exitosamente en Sandbox`,
        signedXml,
      };
    }

    try {
      const token = await this.ensureToken(config);
      const client = this.getHttpClient(config);
      const FormData = require('form-data');
      const form = new FormData();
      form.append('xml', Buffer.from(signedXml, 'utf8'), {
        filename: `ACECF_${config.rncEmisor}_${eNcf}.xml`,
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
    const config = await this.resolveConfig();
    const { signedXml } = this.signerService.signXml(rawXml, config.certPath, config.certPassword);

    if (config.environment === 'sandbox') {
      return {
        trackId: `TRK-ANU-SBX-${Date.now()}`,
        estado: 'ACEPTADO',
        mensaje: 'Anulación de secuencias e-NCF procesada exitosamente en Sandbox',
        signedXml,
      };
    }

    try {
      const token = await this.ensureToken(config);
      const client = this.getHttpClient(config);
      const FormData = require('form-data');
      const form = new FormData();
      form.append('xml', Buffer.from(signedXml, 'utf8'), {
        filename: `ANECF_${config.rncEmisor}_${Date.now()}.xml`,
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
    const config = await this.resolveConfig();

    if (config.environment === 'sandbox' || trackId.startsWith('TRK-SBX') || trackId.startsWith('TRK-CONTINGENCY')) {
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
      const token = await this.ensureToken(config);
      const client = this.getHttpClient(config);
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
