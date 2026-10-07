import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CountryEntity } from '../../geography/entities/country.entity';
import { ProvinceEntity } from '../../geography/entities/province.entity';
import { MunicipalityEntity } from '../../geography/entities/municipality.entity';
import { SectorEntity } from '../../geography/entities/sector.entity';
import { encryptSecret, decryptSecretSafe } from '../../../common/utils/secret-crypto.util';

/**
 * Perfil fiscal/institucional/de marca de ESTE tenant — una sola fila por DB
 * de tenant (Fase 4 del plan multi-tenant). Antes se llamaba `TenantConfigEntity`
 * y soportaba varias filas ("multi-empresa" dentro de una sola DB); ese picker
 * ya no tiene sentido una vez que cada ISP tiene su propia base de datos
 * aislada — ver `sec.company_profile` (migración 054).
 */
@Entity({ schema: 'sec', name: 'company_profile' })
export class CompanyProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ name: 'company_name', type: 'varchar', length: 200 })
  companyName: string;

  @Column({ name: 'commercial_name', type: 'varchar', length: 200, nullable: true })
  commercialName?: string;

  @Column({ type: 'varchar', length: 20 })
  rnc: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ name: 'country_id', type: 'uuid', nullable: true })
  countryId?: string;

  @ManyToOne(() => CountryEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'country_id' })
  country?: CountryEntity;

  @Column({ name: 'province_id', type: 'uuid', nullable: true })
  provinceId?: string;

  @ManyToOne(() => ProvinceEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'province_id' })
  province?: ProvinceEntity;

  @Column({ name: 'municipality_id', type: 'uuid', nullable: true })
  municipalityId?: string;

  @ManyToOne(() => MunicipalityEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'municipality_id' })
  municipality?: MunicipalityEntity;

  @Column({ name: 'sector_id', type: 'uuid', nullable: true })
  sectorId?: string;

  @ManyToOne(() => SectorEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'sector_id' })
  sector?: SectorEntity;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string;

  @Column({ name: 'support_email', type: 'varchar', length: 150, nullable: true })
  supportEmail?: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  website?: string;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl?: string;

  @Column({ type: 'varchar', length: 10, default: 'DOP' })
  currency: string;

  @Column({ type: 'varchar', length: 50, default: 'America/Santo_Domingo' })
  timezone: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // --- DGII (Fase 4: antes env vars globales, ahora por tenant) ---
  @Column({ name: 'dgii_environment', type: 'varchar', length: 20, nullable: true })
  dgiiEnvironment?: string;

  @Column({ name: 'dgii_auth_url', type: 'text', nullable: true })
  dgiiAuthUrl?: string;

  // Object key en MinIO (bucket de `storage`), no un path de disco local — ver
  // CompanyService.uploadDgiiCertificate / DgiiClientService.resolveConfig.
  @Column({ name: 'dgii_cert_object_key', type: 'text', nullable: true })
  dgiiCertObjectKey?: string;

  // Cifrado en reposo (AES-256-GCM) vía transformer de columna — `text` en vez
  // de `varchar(200)` porque el ciphertext+IV+authTag en base64 es más largo
  // que la contraseña original. Ver src/common/utils/secret-crypto.util.ts.
  @Column({
    name: 'dgii_cert_password',
    type: 'text',
    nullable: true,
    transformer: { to: encryptSecret, from: decryptSecretSafe },
  })
  dgiiCertPassword?: string;

  // Contenido del sitio público del tenant (Fase 5/7 lo consumen vía
  // GET /public/site-content) — hero/about/FAQ/oficinas/equipos/logos de
  // clientes. Deliberadamente flexible (jsonb), no una tabla por sección.
  @Column({ name: 'site_content', type: 'jsonb', default: {} })
  siteContent: Record<string, any>;

  @Column({ type: 'varchar', length: 50, nullable: true })
  whatsapp?: string;

  @Column({ name: 'suspension_portal', type: 'jsonb', default: {} })
  suspensionPortal: Record<string, any>;

  @Column({ name: 'telegram_bot_token', type: 'varchar', length: 200, nullable: true })
  telegramBotToken?: string;

  @Column({ name: 'telegram_chat_id', type: 'varchar', length: 100, nullable: true })
  telegramChatId?: string;

  @Column({ name: 'telegram_alerts_enabled', type: 'boolean', default: false })
  telegramAlertsEnabled: boolean;

  @Column({ name: 'contract_clauses', type: 'text', array: true, nullable: true })
  contractClauses?: string[];

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
