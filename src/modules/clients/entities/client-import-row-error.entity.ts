import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { ClientImportBatchEntity } from './client-import-batch.entity';

@Entity({ schema: 'com', name: 'client_import_row_errors' })
export class ClientImportRowErrorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @ManyToOne(() => ClientImportBatchEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'batch_id' })
  batch: ClientImportBatchEntity;

  @Column({ name: 'row_number', type: 'int' })
  rowNumber: number;

  @Column({ name: 'raw_data', type: 'jsonb', nullable: true })
  rawData?: Record<string, string>;

  @Column({ name: 'error_message', type: 'text' })
  errorMessage: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
