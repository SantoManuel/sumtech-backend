import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';

export type ClientImportBatchStatus = 'ANALYZED' | 'MAPPED' | 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED';
export type ClientImportFormat = 'csv' | 'excel';

export interface LocationMappingTarget {
  sectorId?: string;
  createNew?: { name: string; municipalityId: string };
}

@Entity({ schema: 'com', name: 'client_import_batches' })
export class ClientImportBatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, default: 'ANALYZED' })
  status: ClientImportBatchStatus;

  @Column({ type: 'varchar', length: 10 })
  format: ClientImportFormat;

  @Column({ name: 'original_filename', type: 'varchar', length: 255 })
  originalFilename: string;

  @Column({ name: 'minio_object_key', type: 'varchar', length: 255 })
  minioObjectKey: string;

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows: number;

  @Column({ name: 'processed_rows', type: 'int', default: 0 })
  processedRows: number;

  @Column({ name: 'created_count', type: 'int', default: 0 })
  createdCount: number;

  @Column({ name: 'updated_count', type: 'int', default: 0 })
  updatedCount: number;

  @Column({ name: 'error_count', type: 'int', default: 0 })
  errorCount: number;

  @Column({ name: 'location_mapping', type: 'jsonb', default: {} })
  locationMapping: Record<string, LocationMappingTarget>;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy?: string;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by' })
  uploader?: UserEntity;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason?: string;

  /**
   * Object key en MinIO del CSV de usuario/contraseña de cada cliente creado
   * en este batch — se genera una sola vez al terminar el procesamiento
   * (ClientsImportProcessor), es la vía de entrega de credenciales para la
   * importación masiva (no hay un admin imprimiendo cada contrato uno por uno).
   */
  @Column({ name: 'credentials_report_object_key', type: 'varchar', length: 255, nullable: true })
  credentialsReportObjectKey?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp with time zone', nullable: true })
  completedAt?: Date;
}
