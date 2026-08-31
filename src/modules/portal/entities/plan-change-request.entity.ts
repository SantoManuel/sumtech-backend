import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ClientEntity } from '../../clients/entities/client.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';

@Entity({ schema: 'com', name: 'plan_change_requests' })
export class PlanChangeRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'contract_id', type: 'uuid' })
  contractId: string;

  @ManyToOne(() => ContractEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: ContractEntity;

  @Column({ name: 'current_plan_id', type: 'uuid' })
  currentPlanId: string;

  @ManyToOne(() => PlanEntity)
  @JoinColumn({ name: 'current_plan_id' })
  currentPlan: PlanEntity;

  @Column({ name: 'requested_plan_id', type: 'uuid' })
  requestedPlanId: string;

  @ManyToOne(() => PlanEntity)
  @JoinColumn({ name: 'requested_plan_id' })
  requestedPlan: PlanEntity;

  @Column({ name: 'prorated_amount', type: 'decimal', precision: 12, scale: 2, default: 0.00 })
  proratedAmount: number;

  @Column({
    type: 'enum',
    enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
    default: 'PENDING_APPROVAL',
  })
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
