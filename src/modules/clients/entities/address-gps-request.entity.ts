import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { AddressEntity } from './address.entity';

export type AddressGpsRequestStatus = 'PENDING' | 'SUBMITTED' | 'EXPIRED';

/**
 * Solicitud de ubicación GPS enviada como enlace al celular del cliente — el
 * cliente comparte su ubicación real desde su propio teléfono, sin que el
 * agente de oficina necesite estar físicamente presente. Token de un solo uso.
 */
@Entity({ schema: 'com', name: 'address_gps_requests' })
export class AddressGpsRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'address_id', type: 'uuid' })
  addressId: string;

  @ManyToOne(() => AddressEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'address_id' })
  address: AddressEntity;

  @Column({ type: 'varchar', length: 64, unique: true })
  token: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: AddressGpsRequestStatus;

  @Column({ name: 'expires_at', type: 'timestamp with time zone' })
  expiresAt: Date;

  @Column({ name: 'submitted_at', type: 'timestamp with time zone', nullable: true })
  submittedAt?: Date;

  @Column({ name: 'submitted_latitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  submittedLatitude?: number;

  @Column({ name: 'submitted_longitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  submittedLongitude?: number;

  @Column({ name: 'submitted_accuracy', type: 'decimal', precision: 10, scale: 2, nullable: true })
  submittedAccuracy?: number;

  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
