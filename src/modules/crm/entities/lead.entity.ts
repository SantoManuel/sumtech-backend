import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { PlanEntity } from '../../plans/entities/plan.entity';

@Entity({ schema: 'crm', name: 'leads' })
export class LeadEntity {
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
    enum: ['WEB_LANDING', 'CALL_INBOUND', 'WHATSAPP', 'FLYER'], 
    default: 'WEB_LANDING' 
  })
  source: 'WEB_LANDING' | 'CALL_INBOUND' | 'WHATSAPP' | 'FLYER';

  @Column({ 
    type: 'enum', 
    enum: ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISCARDED'], 
    default: 'NEW' 
  })
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'DISCARDED';

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
