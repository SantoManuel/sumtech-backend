import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { ClientEntity } from '../../clients/entities/client.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { OpportunityEntity } from './opportunity.entity';

/**
 * Actividad/interacción — puede colgar de un Client ya formal, de una
 * Opportunity todavía en el embudo (sin cliente aún), o de ambos a la vez
 * tras el cierre. Al menos uno de los dos es obligatorio (constraint
 * `chk_interactions_client_or_opportunity` en la migración 047).
 */
@Entity({ schema: 'crm', name: 'interactions' })
export class InteractionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId?: string;

  @ManyToOne(() => ClientEntity, { nullable: true })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  @Column({ name: 'opportunity_id', type: 'uuid', nullable: true })
  opportunityId?: string;

  @ManyToOne(() => OpportunityEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opportunity_id' })
  opportunity?: OpportunityEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ 
    type: 'enum', 
    enum: ['PHONE_CALL', 'EMAIL', 'WHATSAPP', 'IN_PERSON', 'SYSTEM_EVENT'], 
    default: 'PHONE_CALL' 
  })
  channel: 'PHONE_CALL' | 'EMAIL' | 'WHATSAPP' | 'IN_PERSON' | 'SYSTEM_EVENT';

  @Column({ type: 'varchar', length: 150 })
  subject: string;

  @Column({ type: 'text' })
  notes: string;

  @Column({ name: 'next_follow_up_date', type: 'timestamp with time zone', nullable: true })
  nextFollowUpDate?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
