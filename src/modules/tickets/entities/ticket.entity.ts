import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  ManyToOne, 
  JoinColumn, 
  OneToMany, 
  CreateDateColumn 
} from 'typeorm';
import { ClientEntity } from '../../clients/entities/client.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { EmployeeEntity } from '../../employees/entities/employee.entity';
import { SlaPolicyEntity } from './sla-policy.entity';
import { TicketHistoryEntity } from './ticket-history.entity';
import { TicketRepairEntity } from './ticket-repair.entity';

@Entity({ schema: 'tickets', name: 'tickets' })
export class TicketEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'ticket_number', type: 'varchar', length: 50, unique: true })
  ticketNumber: string; // ej. TCK-2026-00450

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'contract_id', type: 'uuid', nullable: true })
  contractId?: string;

  @ManyToOne(() => ContractEntity, { nullable: true })
  @JoinColumn({ name: 'contract_id' })
  contract?: ContractEntity;

  @Column({ name: 'assigned_employee_id', type: 'uuid', nullable: true })
  assignedEmployeeId?: string;

  @ManyToOne(() => EmployeeEntity, { nullable: true })
  @JoinColumn({ name: 'assigned_employee_id' })
  assignedEmployee?: EmployeeEntity;

  @Column({ 
    type: 'enum', 
    enum: ['INSTALLATION', 'REPAIR_FAULT', 'MAINTENANCE', 'DISCONNECTION'], 
    default: 'INSTALLATION' 
  })
  type: 'INSTALLATION' | 'REPAIR_FAULT' | 'MAINTENANCE' | 'DISCONNECTION';

  @Column({ 
    type: 'enum', 
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], 
    default: 'MEDIUM' 
  })
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @Column({ 
    type: 'enum', 
    enum: ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED'], 
    default: 'OPEN' 
  })
  status: 'OPEN' | 'IN_PROGRESS' | 'ON_HOLD' | 'RESOLVED' | 'CLOSED';

  @Column({ name: 'sla_policy_id', type: 'uuid', nullable: true })
  slaPolicyId?: string;

  @ManyToOne(() => SlaPolicyEntity, (sla) => sla.tickets, { nullable: true })
  @JoinColumn({ name: 'sla_policy_id' })
  slaPolicy?: SlaPolicyEntity;

  @Column({ name: 'due_date', type: 'timestamp with time zone', nullable: true })
  dueDate?: Date;

  @Column({ name: 'scheduled_start', type: 'timestamp with time zone', nullable: true })
  scheduledStart?: Date;

  @Column({ name: 'estimated_duration_minutes', type: 'int', default: 60, nullable: true })
  estimatedDurationMinutes?: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @OneToMany(() => TicketHistoryEntity, (history) => history.ticket, { cascade: true })
  history?: TicketHistoryEntity[];

  @OneToMany(() => TicketRepairEntity, (repair) => repair.ticket, { cascade: true })
  repairs?: TicketRepairEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp with time zone', nullable: true })
  resolvedAt?: Date;

  @Column({ name: 'closed_at', type: 'timestamp with time zone', nullable: true })
  closedAt?: Date;
}
