import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TENANT_DATA_SOURCE } from '../../common/tenancy/tenant-datasource.provider';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MinioStorageService } from '../storage/minio-storage.service';
import { CompanyProfileEntity } from './entities/company-profile.entity';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';

export interface CompanyFiscalInfo {
  rnc: string;
  razonSocial: string;
  nombreComercial?: string;
  direccion?: string;
  municipio?: string;
  provincia?: string;
  correo?: string;
  telefono?: string;
  website?: string;
}

export interface DgiiTenantSettings {
  environment?: string;
  authUrl?: string;
  certObjectKey?: string;
  certPassword?: string;
}

const DEFAULT_SITE_CONTENT = {
  hero: {
    title: 'Internet de fibra óptica confiable',
    subtitle: 'Configura el contenido de tu sitio público desde Configuración > Empresa.',
  },
  about: '',
  faq: [],
  officeInfo: {},
  equipmentShowcase: [],
  clientLogos: [],
};

/**
 * Perfil de ESTE tenant — una sola fila por DB de tenant (Fase 4 del plan
 * multi-tenant). Repurpose de lo que antes era un picker "multi-empresa"
 * (findAll/create/setDefault) dentro de una sola DB — ya no tiene sentido una
 * vez que cada ISP tiene su propia base de datos aislada.
 */
@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);

  constructor(
    @InjectRepository(CompanyProfileEntity)
    private readonly profileRepository: Repository<CompanyProfileEntity>,
    @Inject(TENANT_DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly minioStorage: MinioStorageService,
  ) {}

  /**
   * Obtiene el perfil de este tenant, creando uno mínimo si todavía no existe
   * (get-or-create, sin depender de un hook de boot — antes esto corría en
   * `onModuleInit()`, que fallaba silenciosamente porque al arrancar Nest no
   * hay ningún contexto de tenant activo bajo el motor de tenancy de la Fase
   * 1). Un tenant aprovisionado por la Fase 3 ya nace con esta fila sembrada
   * (`tenant-bootstrap-seed.ts`); este fallback cubre tenants más antiguos
   * (`sumtech`, `tenant_test_a`/`b`) que existían antes de ese seed.
   */
  async getProfile(): Promise<CompanyProfileEntity> {
    let profile = await this.profileRepository.findOne({
      where: {},
      relations: ['country', 'province', 'municipality', 'sector'],
      order: { createdAt: 'ASC' },
    });

    if (!profile) {
      this.logger.log('Sembrando perfil de empresa mínimo para este tenant...');
      profile = this.profileRepository.create({
        name: 'Mi Empresa',
        companyName: 'Mi Empresa',
        rnc: '000000000',
        currency: 'DOP',
        timezone: 'America/Santo_Domingo',
        isActive: true,
        siteContent: DEFAULT_SITE_CONTENT,
        settings: {},
      });
      profile = await this.profileRepository.save(profile);
    }

    return profile;
  }

  async findById(id: string): Promise<CompanyProfileEntity> {
    const profile = await this.profileRepository.findOne({
      where: { id },
      relations: ['country', 'province', 'municipality', 'sector'],
    });
    if (!profile) {
      // No debería pasar en operación normal (una sola fila por DB) — cae de
      // vuelta al get-or-create en vez de un 404 confuso para el caller.
      return this.getProfile();
    }
    return profile;
  }

  async update(dto: UpdateCompanyProfileDto): Promise<CompanyProfileEntity> {
    const profile = await this.getProfile();

    // Un `dgiiCertPassword` vacío/no provisto significa "no tocar la
    // contraseña actual" — el mismo guard que ya usaba `DgiiClientService.
    // updateConfig()` para su propio flujo, ahora también aquí porque el
    // GET /company/config genérico enmascara este campo (ver
    // `CompanyController.getConfig`), así que el formulario del ERP nunca
    // tiene el valor real para hacer round-trip.
    const patch: Partial<UpdateCompanyProfileDto> = { ...dto };
    if (!patch.dgiiCertPassword) {
      delete patch.dgiiCertPassword;
    }

    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CompanyProfileEntity);
      Object.assign(profile, patch);
      const saved = await repo.save(profile);
      this.eventEmitter.emit('company.profile.updated', { profileId: saved.id });
      return saved;
    });
  }

  /**
   * Sube el certificado DGII (.p12/.pfx) de este tenant a MinIO y lo asocia
   * al perfil — reemplaza el `DGII_CERT_PATH` global que antes servía a
   * todos los tenants por igual (cada ISP factura bajo su propio RNC y
   * certificado).
   */
  async uploadDgiiCertificate(buffer: Buffer, originalName: string): Promise<CompanyProfileEntity> {
    const profile = await this.getProfile();
    const objectKey = await this.minioStorage.uploadBuffer(
      buffer,
      originalName,
      'dgii-certs',
      'application/x-pkcs12',
    );
    profile.dgiiCertObjectKey = objectKey;
    return this.profileRepository.save(profile);
  }

  /**
   * Sube el logotipo corporativo de este tenant a MinIO y actualiza el perfil
   * para reflejarlo en toda la aplicación (Sidebar, Header, Facturas, Portal).
   */
  async uploadCompanyLogo(buffer: Buffer, originalName: string, mimeType: string): Promise<CompanyProfileEntity> {
    const profile = await this.getProfile();
    const objectKey = await this.minioStorage.uploadBuffer(
      buffer,
      originalName,
      'company-logos',
      mimeType,
    );

    profile.settings = {
      ...(profile.settings || {}),
      logoObjectKey: objectKey,
      logoMimeType: mimeType,
    };
    profile.logoUrl = '/api/v1/company/logo';

    const saved = await this.profileRepository.save(profile);
    this.eventEmitter.emit('company.profile.updated', { profileId: saved.id });
    return saved;
  }

  /**
   * Elimina el logotipo personalizado de este tenant y restaura el estado por defecto.
   */
  async deleteCompanyLogo(): Promise<CompanyProfileEntity> {
    const profile = await this.getProfile();
    profile.logoUrl = null as any;
    if (profile.settings) {
      delete profile.settings.logoObjectKey;
      delete profile.settings.logoMimeType;
    }

    const saved = await this.profileRepository.save(profile);
    this.eventEmitter.emit('company.profile.updated', { profileId: saved.id });
    return saved;
  }

  /**
   * Obtiene los bytes del logotipo de este tenant desde MinIO para transmisión directa.
   */
  async getCompanyLogo(): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const profile = await this.getProfile();
    const objectKey = profile.settings?.logoObjectKey;
    if (!objectKey) {
      return null;
    }

    try {
      const buffer = await this.minioStorage.getObjectBuffer(objectKey);
      const mimeType = profile.settings?.logoMimeType || 'image/png';
      return { buffer, mimeType };
    } catch (err: any) {
      this.logger.warn(`No se pudo leer el logo de MinIO (${objectKey}): ${err.message}`);
      return null;
    }
  }

  /**
   * Configuración DGII de este tenant, tal como la persiste `update()` —
   * `DgiiClientService.resolveConfig()` la mezcla con los defaults de env var.
   */
  async getDgiiSettings(): Promise<DgiiTenantSettings> {
    const profile = await this.getProfile();
    return {
      environment: profile.dgiiEnvironment,
      authUrl: profile.dgiiAuthUrl,
      certObjectKey: profile.dgiiCertObjectKey,
      certPassword: profile.dgiiCertPassword,
    };
  }

  /**
   * Descarga los bytes del certificado DGII de este tenant desde MinIO —
   * usado por `DgiiClientService` para materializarlo en un archivo temporal
   * (la librería de firma exige un path de archivo, no un buffer).
   */
  async getDgiiCertificateBuffer(objectKey: string): Promise<Buffer> {
    return this.minioStorage.getObjectBuffer(objectKey);
  }

  /**
   * Retorna la proyección formateada de información fiscal para consumo
   * directo de DGII y generadores PDF.
   */
  async getCompanyFiscalInfo(): Promise<CompanyFiscalInfo> {
    const profile = await this.getProfile();

    return {
      rnc: profile.rnc,
      razonSocial: profile.companyName,
      nombreComercial: profile.commercialName || profile.companyName,
      direccion: profile.address,
      municipio: profile.municipality?.code || '010100',
      provincia: profile.province?.code || '010000',
      correo: profile.email,
      telefono: profile.phone,
      website: profile.website,
    };
  }
}
