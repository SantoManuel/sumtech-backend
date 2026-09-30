import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { OltEntity } from './olt.entity';

@Entity({ schema: 'net', name: 'olt_metrics' })
@Index(['oltId', 'createdAt'])
export class OltMetricEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @ManyToOne(() => OltEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'olt_id' })
  olt: OltEntity;

  @Column({ name: 'cpu_usage_percent', type: 'numeric', precision: 5, scale: 2, nullable: true })
  cpuUsagePercent?: number;

  @Column({ name: 'memory_usage_percent', type: 'numeric', precision: 5, scale: 2, nullable: true })
  memoryUsagePercent?: number;

  @Column({ name: 'temperature_celsius', type: 'numeric', precision: 5, scale: 2, nullable: true })
  temperatureCelsius?: number;

  @Column({ name: 'uptime_seconds', type: 'bigint', nullable: true })
  uptimeSeconds?: number;

  @Column({ name: 'active_onus_count', type: 'int', default: 0 })
  activeOnusCount: number;

  @Column({ name: 'offline_onus_count', type: 'int', default: 0 })
  offlineOnusCount: number;

  @Column({ name: 'alarms_count', type: 'int', default: 0 })
  alarmsCount: number;

  @Column({ name: 'cards_info', type: 'jsonb', default: [] })
  cardsInfo: Array<{
    slot: string;
    cardType: string;
    status: string;
    ports?: number;
    softwareVersion?: string;
  }>;

  @Column({ name: 'alarms_info', type: 'jsonb', default: [] })
  alarmsInfo: Array<{
    level: string;
    code: string;
    description: string;
    timestamp?: string;
    target?: string;
  }>;

  @Column({ name: 'raw_telemetry', type: 'jsonb', default: {} })
  rawTelemetry: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
