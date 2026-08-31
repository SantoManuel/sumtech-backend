import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'pos', name: 'ecf_sequences' })
export class EcfSequenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ 
    name: 'ncf_type', 
    type: 'enum', 
    enum: ['E31', 'E32', 'E33', 'E34', 'E44', 'E45', 'B01', 'B02'], 
    unique: true 
  })
  ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02';

  @Column({ type: 'varchar', length: 5, default: 'E' })
  serie: string;

  @Column({ name: 'current_sequence', type: 'bigint', default: 1 })
  currentSequence: number;

  @Column({ name: 'start_sequence', type: 'bigint', default: 1 })
  startSequence: number;

  @Column({ name: 'end_sequence', type: 'bigint', default: 100000 })
  endSequence: number;

  @Column({ name: 'authorization_number', type: 'varchar', length: 50, default: '6005450276' })
  authorizationNumber: string;

  @Column({ name: 'expiry_date', type: 'varchar', length: 20, default: '31-12-2026' })
  expiryDate: string;

  @Column({ name: 'alert_remaining', type: 'int', default: 50 })
  alertRemaining: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
