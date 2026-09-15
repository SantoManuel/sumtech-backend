import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { ClientEntity } from './client.entity';
import { ContractEntity } from './contract.entity';
import { CountryEntity } from '../../geography/entities/country.entity';
import { ProvinceEntity } from '../../geography/entities/province.entity';
import { MunicipalityEntity } from '../../geography/entities/municipality.entity';
import { SectorEntity } from '../../geography/entities/sector.entity';

@Entity({ schema: 'com', name: 'addresses' })
export class AddressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => ClientEntity, (client) => client.addresses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ type: 'varchar', length: 150 })
  street: string;

  @Column({ name: 'building_number', type: 'varchar', length: 50, nullable: true })
  buildingNumber?: string;

  @Column({ type: 'varchar', length: 100 })
  sector: string;

  @Column({ type: 'varchar', length: 100 })
  municipality: string;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  // Copias de texto denormalizadas de sector/municipality/city de arriba — se
  // mantienen por compatibilidad con lectores existentes (PDF de contrato,
  // ticket de factura, fallback de geocodificación de los mapas de tickets).
  // Estas 4 relaciones son la fuente normalizada cuando el cliente se crea
  // usando los selects en cascada del módulo de geografía.
  @Column({ name: 'country_id', type: 'uuid', nullable: true })
  countryId?: string;

  @ManyToOne(() => CountryEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'country_id' })
  countryGeo?: CountryEntity;

  @Column({ name: 'province_id', type: 'uuid', nullable: true })
  provinceId?: string;

  @ManyToOne(() => ProvinceEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'province_id' })
  provinceGeo?: ProvinceEntity;

  @Column({ name: 'municipality_id', type: 'uuid', nullable: true })
  municipalityId?: string;

  @ManyToOne(() => MunicipalityEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'municipality_id' })
  municipalityGeo?: MunicipalityEntity;

  @Column({ name: 'sector_id', type: 'uuid', nullable: true })
  sectorId?: string;

  @ManyToOne(() => SectorEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'sector_id' })
  sectorGeo?: SectorEntity;

  @Column({ name: 'gps_latitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  gpsLatitude?: number;

  @Column({ name: 'gps_longitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  gpsLongitude?: number;

  @Column({ type: 'text', nullable: true })
  reference?: string;

  @Column({ name: 'is_primary', type: 'boolean', default: true })
  isPrimary: boolean;

  @OneToMany(() => ContractEntity, (contract) => contract.address)
  contracts?: ContractEntity[];
}
