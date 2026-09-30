import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PlatformUserEntity } from './platform-user.entity';

@Entity({ schema: 'platform', name: 'platform_audit_logs' })
export class PlatformAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'platform_user_id', type: 'uuid', nullable: true })
  platformUserId?: string;

  @ManyToOne(() => PlatformUserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'platform_user_id' })
  platformUser?: PlatformUserEntity;

  @Column({ type: 'varchar', length: 100 })
  action: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  entity?: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 100, nullable: true })
  entityId?: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
