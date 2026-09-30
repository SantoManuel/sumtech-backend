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

  // Política de conteo de días para prorratear la primera factura de un
  // contrato activado a mitad de período (sección 9 del spec de facturación).
  @Column({ name: 'proration_day_count_policy', type: 'varchar', length: 20, default: 'FIXED_30' })
  prorationDayCountPolicy: 'FIXED_30' | 'ACTUAL_MONTH_DAYS' | 'CYCLE_DAYS';

  // Monto fijo global del cargo de reconexión al regularizar un contrato
  // SUSPENDED (sección 15 del spec de facturación) — cobrado junto con las
  // facturas vencidas en PosService.collectInvoices().
  @Column({ name: 'reconnection_fee_amount', type: 'decimal', precision: 10, scale: 2, default: 500.0 })
  reconnectionFeeAmount: number;

  // Tope en RD$ de descuento que un CAJERO puede aplicar sin autorización de
  // un supervisor (ADMIN/GERENTE) — por encima, PosService exige credenciales
  // de supervisor. ADMIN/GERENTE quedan exentos del tope.
  @Column({ name: 'cashier_discount_cap_amount', type: 'decimal', precision: 10, scale: 2, default: 500.0 })
  cashierDiscountCapAmount: number;

  // Ventana máxima en horas dentro de la cual un CAJERO puede anular (emitir
  // Nota de Crédito E34) una factura que él mismo procesó. Superada esta ventana,
  // solo un supervisor (ADMIN/GERENTE) tiene autorización.
  @Column({ name: 'cashier_void_window_hours', type: 'int', default: 48 })
  cashierVoidWindowHours: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
