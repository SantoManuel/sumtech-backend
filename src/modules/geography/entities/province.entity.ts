import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { CountryEntity } from './country.entity';
import { MunicipalityEntity } from './municipality.entity';

@Entity({ schema: 'geo', name: 'provinces' })
export class ProvinceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'country_id', type: 'uuid' })
  countryId: string;

  @ManyToOne(() => CountryEntity, (country) => country.provinces, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'country_id' })
  country: CountryEntity;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  code?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @OneToMany(() => MunicipalityEntity, (municipality) => municipality.province)
  municipalities?: MunicipalityEntity[];
}
