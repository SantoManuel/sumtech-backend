import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';

export type NotificationCategory = 'INVENTORY' | 'OPERATIONS' | 'NETWORK' | 'BILLING' | 'SYSTEM';
export type NotificationSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
export type NotificationTargetRole = 'ADMIN' | 'TECNICO' | 'CAJERO' | 'GERENTE' | 'ALL';

@Entity({ schema: 'sec', name: 'staff_notifications' })
export class StaffNotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_staff_notifications_user_read')
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity | null;

  @Index('idx_staff_notifications_role_read')
  @Column({ name: 'target_role', type: 'varchar', length: 50, default: 'ALL' })
  targetRole: NotificationTargetRole;

  @Index('idx_staff_notifications_category')
  @Column({ type: 'varchar', length: 50, default: 'SYSTEM' })
  category: NotificationCategory;

  @Column({ type: 'varchar', length: 20, default: 'INFO' })
  severity: NotificationSeverity;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  link?: string | null;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @Column({ name: 'read_at', type: 'timestamp with time zone', nullable: true })
  readAt?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Index('idx_staff_notifications_created_at')
  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
