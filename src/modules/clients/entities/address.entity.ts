import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { ClientEntity } from './client.entity';
import { ContractEntity } from './contract.entity';

@Entity({ schema: 'com', name: 'addresses' })
export class AddressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => ClientEntity, (client) => client.addresses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ type: 'varchar', length: 150 })
  street: string;

  @Column({ name: 'building_number', type: 'varchar', length: 50, nullable: true })
  buildingNumber?: string;

  @Column({ type: 'varchar', length: 100 })
  sector: string;

  @Column({ type: 'varchar', length: 100 })
  municipality: string;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ name: 'gps_latitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  gpsLatitude?: number;

  @Column({ name: 'gps_longitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  gpsLongitude?: number;

  @Column({ type: 'text', nullable: true })
  reference?: string;

  @Column({ name: 'is_primary', type: 'boolean', default: true })
  isPrimary: boolean;

  @OneToMany(() => ContractEntity, (contract) => contract.address)
  contracts?: ContractEntity[];
}
