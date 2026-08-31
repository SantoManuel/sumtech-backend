import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ContractEntity } from '../../clients/entities/contract.entity';

@Entity({ schema: 'com', name: 'plans' })
export class PlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'service_type', type: 'enum', enum: ['INTERNET', 'TV', 'DUAL'], default: 'INTERNET' })
  serviceType: 'INTERNET' | 'TV' | 'DUAL';

  @Column({ name: 'speed_mbps', type: 'int', default: 0 })
  speedMbps: number;

  @Column({ name: 'tv_channels_count', type: 'int', default: 0 })
  tvChannelsCount: number;

  @Column({ name: 'monthly_price', type: 'decimal', precision: 10, scale: 2 })
  monthlyPrice: number;

  @Column({ name: 'itbis_rate', type: 'decimal', precision: 4, scale: 2, default: 0.18 })
  itbisRate: number;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'is_featured', type: 'boolean', default: false })
  isFeatured: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => ContractEntity, (contract) => contract.plan)
  contracts?: ContractEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
