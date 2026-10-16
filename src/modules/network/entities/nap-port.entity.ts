import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NapBoxEntity } from './nap-box.entity';
import { OnuEntity } from '../../olt/entities/onu.entity';
import { numericTransformer } from '../../../common/utils/numeric.transformer';

export type NapPortStatus = 'DISPONIBLE' | 'OCUPADO' | 'DANADO' | 'RESERVADO';

@Entity({ schema: 'net', name: 'nap_ports' })
export class NapPortEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'nap_id', type: 'uuid' })
  napId: string;

  @ManyToOne(() => NapBoxEntity, (box) => box.ports, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'nap_id' })
  nap: NapBoxEntity;

  @Column({ name: 'port_number', type: 'int' })
  portNumber: number;

  @Column({ name: 'onu_id', type: 'uuid', nullable: true })
  onuId?: string | null;

  @ManyToOne(() => OnuEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'onu_id' })
  onu?: OnuEntity;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'DISPONIBLE',
  })
  status: NapPortStatus;

  @Column({
    name: 'attenuation_db',
    type: 'numeric',
    precision: 4,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  attenuationDb?: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes?: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
