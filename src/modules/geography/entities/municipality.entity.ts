import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { ProvinceEntity } from './province.entity';
import { SectorEntity } from './sector.entity';

@Entity({ schema: 'geo', name: 'municipalities' })
export class MunicipalityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'province_id', type: 'uuid' })
  provinceId: string;

  @ManyToOne(() => ProvinceEntity, (province) => province.municipalities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'province_id' })
  province: ProvinceEntity;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  code?: string;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @OneToMany(() => SectorEntity, (sector) => sector.municipality)
  sectors?: SectorEntity[];
}
