import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { SubscriptionStatusEntity } from './subscription-status.entity';

/**
 * SLA comercial: máximo de días sin actividad (sin cambio de estado) que una
 * Opportunity puede pasar en un estado no terminal antes de considerarse en
 * riesgo. Una fila por estado (subscription_status_id es UNIQUE) — los
 * estados terminales (SUSCRIPCION_ACTIVA/PERDIDA) normalmente no tienen
 * política porque ya no requieren seguimiento activo.
 */
@Entity({ schema: 'crm', name: 'sla_policies' })
export class SlaPolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_status_id', type: 'uuid', unique: true })
  subscriptionStatusId: string;

  @ManyToOne(() => SubscriptionStatusEntity)
  @JoinColumn({ name: 'subscription_status_id' })
  subscriptionStatus: SubscriptionStatusEntity;

  @Column({ name: 'max_days_without_activity', type: 'int' })
  maxDaysWithoutActivity: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
