import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { OnuEntity } from './onu.entity';
import { numericTransformer } from '../../../common/utils/numeric.transformer';

@Entity({ schema: 'net', name: 'onu_optical_history' })
@Index(['onuId', 'recordedAt'])
export class OnuOpticalHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'onu_id', type: 'uuid' })
  onuId: string;

  @ManyToOne(() => OnuEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'onu_id' })
  onu: OnuEntity;

  @Column({
    name: 'rx_power_dbm',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  rxPowerDbm?: number | null;

  @Column({
    name: 'tx_power_dbm',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  txPowerDbm?: number | null;

  @Column({
    name: 'attenuation_db',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  attenuationDb?: number | null;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamp with time zone' })
  recordedAt: Date;
}
