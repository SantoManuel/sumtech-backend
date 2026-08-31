import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { ClientEntity } from './client.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { AddressEntity } from './address.entity';

@Entity({ schema: 'com', name: 'contracts' })
export class ContractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contract_number', type: 'varchar', length: 50, unique: true })
  contractNumber: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => ClientEntity, (client) => client.contracts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @ManyToOne(() => PlanEntity, (plan) => plan.contracts)
  @JoinColumn({ name: 'plan_id' })
  plan: PlanEntity;

  @Column({ name: 'address_id', type: 'uuid' })
  addressId: string;

  @ManyToOne(() => AddressEntity, (address) => address.contracts)
  @JoinColumn({ name: 'address_id' })
  address: AddressEntity;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate?: string;

  @Column({ name: 'billing_day', type: 'int', default: 15 })
  billingDay: number;

  @Column({ 
    type: 'enum', 
    enum: ['PENDING_INSTALL', 'ACTIVE', 'SUSPENDED', 'TERMINATED'], 
    default: 'PENDING_INSTALL' 
  })
  status: 'PENDING_INSTALL' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
