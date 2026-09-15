import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CountryEntity } from '../../geography/entities/country.entity';
import { ProvinceEntity } from '../../geography/entities/province.entity';
import { MunicipalityEntity } from '../../geography/entities/municipality.entity';
import { SectorEntity } from '../../geography/entities/sector.entity';

/**
 * Entidad de Configuración Corporativa y Multi-Tenant.
 * Almacena los datos fiscales, operativos e institucionales de la empresa o sucursal (tenant),
 * vinculados de forma normalizada con el catálogo geográfico (país, provincia, municipio, sector).
 */
@Entity({ schema: 'sec', name: 'tenant_configs' })
export class TenantConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_tenant_configs_code', { unique: true })
  @Column({ name: 'tenant_code', type: 'varchar', length: 50, unique: true })
  tenantCode: string;

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

  @Index('idx_tenant_configs_is_default')
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
