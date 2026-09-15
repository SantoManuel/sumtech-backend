import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { OpportunityEntity } from './opportunity.entity';
import { SubscriptionStatusEntity } from './subscription-status.entity';
import { UserEntity } from '../../users/entities/user.entity';

/**
 * Auditoría de cada cambio de estado de una Opportunity — quién lo hizo,
 * cuándo, y de qué estado a cuál. Se inserta una fila dentro de la misma
 * operación de `CrmService.updateStatus()`/`closeOpportunity()`, nunca se
 * edita ni se borra después de creada.
 */
@Entity({ schema: 'crm', name: 'opportunity_state_history' })
export class OpportunityStateHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId: string;

  @ManyToOne(() => OpportunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opportunity_id' })
  opportunity: OpportunityEntity;

  @Column({ name: 'previous_status_id', type: 'uuid', nullable: true })
  previousStatusId?: string;

  @ManyToOne(() => SubscriptionStatusEntity, { nullable: true })
  @JoinColumn({ name: 'previous_status_id' })
  previousStatus?: SubscriptionStatusEntity;

  @Column({ name: 'new_status_id', type: 'uuid' })
  newStatusId: string;

  @ManyToOne(() => SubscriptionStatusEntity)
  @JoinColumn({ name: 'new_status_id' })
  newStatus: SubscriptionStatusEntity;

  @Column({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
  changedByUserId?: string;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'changed_by_user_id' })
  changedByUser?: UserEntity;

  @CreateDateColumn({ name: 'changed_at', type: 'timestamp with time zone' })
  changedAt: Date;
}
