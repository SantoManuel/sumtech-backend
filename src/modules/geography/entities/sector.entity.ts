import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { MunicipalityEntity } from './municipality.entity';

@Entity({ schema: 'geo', name: 'sectors' })
export class SectorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'municipality_id', type: 'uuid' })
  municipalityId: string;

  @ManyToOne(() => MunicipalityEntity, (municipality) => municipality.sectors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'municipality_id' })
  municipality: MunicipalityEntity;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
