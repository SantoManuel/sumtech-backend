import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { ClientEntity } from '../../clients/entities/client.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { SubscriptionStatusEntity } from './subscription-status.entity';
import { NextActionEntity } from './next-action.entity';
import { LossReasonEntity } from './loss-reason.entity';
import { LEAD_SOURCE_VALUES, LeadSource } from '../enums/opportunity.enums';

export type ServiceInterest = 'INTERNET' | 'TV' | 'COMBO';
export const SERVICE_INTEREST_VALUES: ServiceInterest[] = ['INTERNET', 'TV', 'COMBO'];

/**
 * Núcleo comercial del CRM: reemplaza a LeadEntity. Una Opportunity nace sin
 * `clientId` (es solo un prospecto) y recién lo obtiene al cerrar vía
 * OpportunitiesService.closeOpportunity() — que crea el Client real (con
 * cédula/RNC) y el Contract, momento en el que pasa a SUSCRIPCION_ACTIVA.
 */
@Entity({ schema: 'crm', name: 'opportunities' })
export class OpportunityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email?: string;

  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId?: string;

  @ManyToOne(() => PlanEntity, { nullable: true })
  @JoinColumn({ name: 'plan_id' })
  plan?: PlanEntity;

  @Column({
    type: 'enum',
    enum: LEAD_SOURCE_VALUES,
    default: 'WEB_LANDING',
  })
  source: LeadSource;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // --- Núcleo de Opportunity (Fase 1) ---

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId?: string;

  @ManyToOne(() => ClientEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  @Column({ name: 'subscription_status_id', type: 'uuid' })
  subscriptionStatusId: string;

  @ManyToOne(() => SubscriptionStatusEntity)
  @JoinColumn({ name: 'subscription_status_id' })
  subscriptionStatus: SubscriptionStatusEntity;

  @Column({ name: 'next_action_id', type: 'uuid', nullable: true })
  nextActionId?: string | null;

  @ManyToOne(() => NextActionEntity, { nullable: true })
  @JoinColumn({ name: 'next_action_id' })
  nextAction?: NextActionEntity | null;

  @Column({ name: 'next_action_date', type: 'date', nullable: true })
  nextActionDate?: string | null;

  @Column({ name: 'potential_value', type: 'decimal', precision: 12, scale: 2, default: 0 })
  potentialValue: number;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId?: string;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_user_id' })
  assignedUser?: UserEntity;

  @Column({ name: 'service_interest', type: 'varchar', length: 20, nullable: true })
  serviceInterest?: ServiceInterest;

  @Column({ name: 'installation_address', type: 'text', nullable: true })
  installationAddress?: string;

  @Column({ name: 'loss_reason_id', type: 'uuid', nullable: true })
  lossReasonId?: string | null;

  @ManyToOne(() => LossReasonEntity, { nullable: true })
  @JoinColumn({ name: 'loss_reason_id' })
  lossReason?: LossReasonEntity;

  @Column({ name: 'first_contact_at', type: 'timestamp with time zone' })
  firstContactAt: Date;

  @UpdateDateColumn({ name: 'last_updated_at', type: 'timestamp with time zone' })
  lastUpdatedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
