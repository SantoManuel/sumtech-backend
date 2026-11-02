import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { WanApplyStatus, WanProvisioningMethod } from '../ports/onu-wan.types';
import { OnuEntity } from './onu.entity';

@Entity({ schema: 'net', name: 'onu_wan_operations' })
@Unique(['onuId', 'version'])
export class OnuWanOperationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'onu_id', type: 'uuid' }) onuId: string;
  @ManyToOne(() => OnuEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'onu_id' }) onu: OnuEntity;
  @Column({ type: 'int' }) version: number;
  @Column({ type: 'varchar', length: 20 }) method: WanProvisioningMethod;
  @Column({ type: 'varchar', length: 30 }) status: WanApplyStatus;
  @Column({ type: 'varchar', length: 100, nullable: true }) actor?: string;
  @Column({ type: 'int', default: 1 }) attempts: number;
  @Column({ name: 'request_fingerprint', type: 'varchar', length: 64, select: false }) requestFingerprint: string;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError: string | null;
  @Column({ type: 'jsonb', nullable: true }) evidence: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true }) finishedAt: Date | null;
}
