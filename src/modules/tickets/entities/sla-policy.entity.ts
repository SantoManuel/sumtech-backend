import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { TicketEntity } from './ticket.entity';

@Entity({ schema: 'tickets', name: 'sla_policies' })
export class SlaPolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string; // ej. 'SLA Crítico Empresa', 'SLA Residencial Estándar'

  @Column({ name: 'max_response_hours', type: 'int', default: 4 })
  maxResponseHours: number;

  @Column({ name: 'max_resolution_hours', type: 'int', default: 24 })
  maxResolutionHours: number;

  @Column({ 
    type: 'enum', 
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], 
    default: 'MEDIUM' 
  })
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @OneToMany(() => TicketEntity, (ticket) => ticket.slaPolicy)
  tickets?: TicketEntity[];
}
