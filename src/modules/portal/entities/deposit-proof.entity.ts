import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ClientEntity } from '../../clients/entities/client.entity';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';

@Entity({ schema: 'pos', name: 'deposit_proofs' })
export class DepositProofEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId?: string;

  @ManyToOne(() => InvoiceEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invoice_id' })
  invoice?: InvoiceEntity;

  @Column({ name: 'bank_name', type: 'varchar', length: 100 })
  bankName: string;

  @Column({ name: 'reference_number', type: 'varchar', length: 100 })
  referenceNumber: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ name: 'deposit_date', type: 'date' })
  depositDate: string;

  /** @deprecated Legado — comprobantes enviados como link antes de exigir archivo. Ya no se escribe en envíos nuevos. */
  @Column({ name: 'receipt_url', type: 'text', nullable: true })
  receiptUrl?: string;

  /** Object key en MinIO del archivo (imagen o PDF) subido como comprobante. Se lee siempre vía URL firmada, nunca como ruta pública. */
  @Column({ name: 'receipt_file_key', type: 'varchar', length: 500, nullable: true })
  receiptFileKey?: string;

  /** Mimetype validado al subir (image/jpeg, image/png o application/pdf) — permite previsualizar sin re-consultar MinIO. */
  @Column({ name: 'receipt_mime_type', type: 'varchar', length: 100, nullable: true })
  receiptMimeType?: string;

  @Column({
    type: 'enum',
    enum: ['PENDING_REVIEW', 'APPROVED', 'REJECTED'],
    default: 'PENDING_REVIEW',
  })
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes?: string;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
