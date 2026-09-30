import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { ClientEntity } from '../../clients/entities/client.entity';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { UserEntity } from '../../users/entities/user.entity';

/**
 * Un registro por episodio de suspensión de un contrato (sección 14 del spec
 * de facturación) — abierto por MorosidadService/ClientsService al suspender,
 * cerrado (reconnected_at) al reactivar. `reconnectedAt IS NULL` identifica la
 * suspensión vigente de un contrato, si la hay.
 */
@Entity({ schema: 'com', name: 'suspension_history' })
export class SuspensionHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contract_id', type: 'uuid' })
  contractId: string;

  @ManyToOne(() => ContractEntity)
  @JoinColumn({ name: 'contract_id' })
  contract?: ContractEntity;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  @Column({ name: 'suspended_at', type: 'timestamp with time zone' })
  suspendedAt: Date;

  @Column({ type: 'text' })
  reason: string;

  @Column({ name: 'related_invoice_id', type: 'uuid', nullable: true })
  relatedInvoiceId?: string;

  @ManyToOne(() => InvoiceEntity, { nullable: true })
  @JoinColumn({ name: 'related_invoice_id' })
  relatedInvoice?: InvoiceEntity;

  @Column({ name: 'triggered_by_user_id', type: 'uuid', nullable: true })
  triggeredByUserId?: string;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'triggered_by_user_id' })
  triggeredByUser?: UserEntity;

  // Nulo cuando triggeredByUserId está presente (suspensión manual). 'CRON_MOROSIDAD'
  // cuando la disparó el cron diario sin usuario asociado.
  @Column({ name: 'triggered_by_process', type: 'varchar', length: 30, nullable: true })
  triggeredByProcess?: 'CRON_MOROSIDAD' | 'MANUAL';

  @Column({ type: 'text', nullable: true })
  observation?: string;

  @Column({ name: 'reconnected_at', type: 'timestamp with time zone', nullable: true })
  reconnectedAt?: Date;

  @Column({ name: 'reconnected_by_user_id', type: 'uuid', nullable: true })
  reconnectedByUserId?: string;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'reconnected_by_user_id' })
  reconnectedByUser?: UserEntity;

  @Column({ name: 'reconnection_fee_invoice_id', type: 'uuid', nullable: true })
  reconnectionFeeInvoiceId?: string;

  @ManyToOne(() => InvoiceEntity, { nullable: true })
  @JoinColumn({ name: 'reconnection_fee_invoice_id' })
  reconnectionFeeInvoice?: InvoiceEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
