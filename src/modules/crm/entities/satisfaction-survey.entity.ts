import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { OpportunityEntity } from './opportunity.entity';

export type SatisfactionSurveyStatus = 'PENDING' | 'SUBMITTED' | 'EXPIRED';

/**
 * Encuesta de satisfacción enviada al cliente por enlace tras el cierre de
 * su Opportunity (mismo patrón de token de un solo uso que
 * com.address_gps_requests) — nunca expone datos del cliente en el enlace
 * público, solo recibe una calificación 1-5 y un comentario opcional.
 */
@Entity({ schema: 'crm', name: 'satisfaction_surveys' })
export class SatisfactionSurveyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId: string;

  @ManyToOne(() => OpportunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opportunity_id' })
  opportunity: OpportunityEntity;

  @Column({ type: 'varchar', length: 64, unique: true })
  token: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: SatisfactionSurveyStatus;

  @Column({ type: 'smallint', nullable: true })
  rating?: number;

  @Column({ type: 'text', nullable: true })
  comment?: string;

  @Column({ name: 'sent_at', type: 'timestamp with time zone' })
  sentAt: Date;

  @Column({ name: 'submitted_at', type: 'timestamp with time zone', nullable: true })
  submittedAt?: Date;

  @Column({ name: 'expires_at', type: 'timestamp with time zone' })
  expiresAt: Date;
}
