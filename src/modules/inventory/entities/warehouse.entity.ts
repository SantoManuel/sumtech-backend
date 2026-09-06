import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { CountryEntity } from '../../geography/entities/country.entity';
import { ProvinceEntity } from '../../geography/entities/province.entity';
import { MunicipalityEntity } from '../../geography/entities/municipality.entity';
import { SectorEntity } from '../../geography/entities/sector.entity';

@Entity({ schema: 'inv', name: 'warehouses' })
export class WarehouseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  code?: string;

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

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode?: string;

  @Column({ name: 'gps_latitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  gpsLatitude?: number;

  @Column({ name: 'gps_longitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  gpsLongitude?: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
