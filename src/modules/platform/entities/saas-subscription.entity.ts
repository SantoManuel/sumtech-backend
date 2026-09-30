import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { SaasSubscriptionStatus } from '../enums/saas-subscription-status.enum';
import { TenantEntity } from './tenant.entity';
import { SaasPlanEntity } from './saas-plan.entity';

@Entity({ schema: 'platform', name: 'saas_subscriptions' })
export class SaasSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: TenantEntity;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @ManyToOne(() => SaasPlanEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_id' })
  plan: SaasPlanEntity;

  @Column({ type: 'enum', enum: SaasSubscriptionStatus, default: SaasSubscriptionStatus.TRIALING })
  status: SaasSubscriptionStatus;

  @Column({ name: 'current_period_end', type: 'timestamp with time zone', nullable: true })
  currentPeriodEnd?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
