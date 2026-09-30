import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type NotificationEventType =
  | 'INVOICE_GENERATED'
  | 'PAYMENT_REMINDER_DUE'
  | 'PAYMENT_REMINDER_OVERDUE'
  | 'SERVICE_SUSPENDED'
  | 'SERVICE_REACTIVATED'
  | 'CONTRACT_ACTIVATED';

export type NotificationChannel = 'IN_APP' | 'SMS' | 'EMAIL' | 'WHATSAPP';

@Entity({ schema: 'com', name: 'notification_templates' })
export class NotificationTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType: NotificationEventType;

  @Column({ type: 'varchar', length: 20, default: 'IN_APP' })
  channel: NotificationChannel;

  @Column({ name: 'title_template', type: 'varchar', length: 200 })
  titleTemplate: string;

  @Column({ name: 'body_template', type: 'text' })
  bodyTemplate: string;

  @Column({ name: 'currency_symbol', type: 'varchar', length: 10, nullable: true })
  currencySymbol?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
