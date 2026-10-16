import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OltEntity } from '../../olt/entities/olt.entity';
import { ZoneEntity } from './zone.entity';
import { NapPortEntity } from './nap-port.entity';
import { numericTransformer } from '../../../common/utils/numeric.transformer';

@Entity({ schema: 'net', name: 'nap_boxes' })
export class NapBoxEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'olt_id', type: 'uuid', nullable: true })
  oltId?: string | null;

  @ManyToOne(() => OltEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'olt_id' })
  olt?: OltEntity;

  @Column({ name: 'pon_interface', type: 'varchar', length: 50, nullable: true })
  ponInterface?: string | null;

  @Column({ name: 'splitter_ratio', type: 'varchar', length: 20, default: '1:16' })
  splitterRatio: string;

  @Column({ name: 'total_ports', type: 'int', default: 16 })
  totalPorts: number;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 7,
    nullable: true,
    transformer: numericTransformer,
  })
  latitude?: number | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 7,
    nullable: true,
    transformer: numericTransformer,
  })
  longitude?: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address?: string | null;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId?: string | null;

  @ManyToOne(() => ZoneEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' })
  zone?: ZoneEntity;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVO' })
  status: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @OneToMany(() => NapPortEntity, (port) => port.nap, { cascade: true })
  ports?: NapPortEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
