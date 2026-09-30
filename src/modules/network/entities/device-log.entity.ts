import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { NetworkNodeEntity } from './network-node.entity';

export type DeviceLogStatus = 'SUCCESS' | 'FAILURE' | 'TIMEOUT';

@Entity({ schema: 'net', name: 'device_logs' })
export class DeviceLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'node_id', type: 'uuid' })
  nodeId: string;

  @ManyToOne(() => NetworkNodeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node?: NetworkNodeEntity;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType: string;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: DeviceLogStatus;

  @Column({ name: 'error_code', type: 'varchar', length: 50, nullable: true })
  errorCode?: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ name: 'raw_details', type: 'jsonb', nullable: true })
  rawDetails?: Record<string, unknown>;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
