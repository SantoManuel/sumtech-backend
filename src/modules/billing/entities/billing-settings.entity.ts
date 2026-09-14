import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Fila única de configuración global del motor de facturación recurrente y
// morosidad (ver migración 020, que siembra la fila por defecto).
@Entity({ schema: 'com', name: 'billing_settings' })
export class BillingSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'grace_days_before_suspension', type: 'int', default: 5 })
  graceDaysBeforeSuspension: number;

  @Column({ name: 'reminder_days_after_due', type: 'int', default: 2 })
  reminderDaysAfterDue: number;

  @Column({ name: 'advance_reminder_days_before_due', type: 'int', default: 3 })
  advanceReminderDaysBeforeDue: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
