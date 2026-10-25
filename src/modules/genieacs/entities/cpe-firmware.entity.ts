import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Catálogo de firmware TR-069 (§3.17 del plan) -- sección de mayor riesgo de
 * toda la pestaña, por eso cada fila guarda el checksum real del archivo
 * subido (auditoría de "qué se empujó exactamente"). Nunca se autodescubre
 * ni se infiere un firmware -- solo lo que el equipo de soporte sube
 * deliberadamente.
 */
@Entity({ schema: 'net', name: 'cpe_firmware' })
export class CpeFirmwareEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  vendor: string;

  @Column({ name: 'model_pattern', type: 'varchar', length: 100, nullable: true })
  modelPattern?: string | null;

  @Column({ type: 'varchar', length: 100 })
  version: string;

  /** Object key en MinIO (bucket por defecto del tenant). */
  @Column({ name: 'object_key', type: 'varchar', length: 500 })
  objectKey: string;

  @Column({ name: 'checksum_sha256', type: 'varchar', length: 64 })
  checksumSha256: string;

  @Column({ name: 'file_size_bytes', type: 'bigint' })
  fileSizeBytes: number;

  @Column({ name: 'uploaded_by', type: 'varchar', length: 100, nullable: true })
  uploadedBy?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
