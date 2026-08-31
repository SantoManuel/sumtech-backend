import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { TicketEntity } from './ticket.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity({ schema: 'tickets', name: 'ticket_history' })
export class TicketHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @ManyToOne(() => TicketEntity, (ticket) => ticket.history, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: TicketEntity;

  @Column({ name: 'previous_status', type: 'varchar', length: 50, nullable: true })
  previousStatus?: string;

  @Column({ name: 'new_status', type: 'varchar', length: 50 })
  newStatus: string;

  @Column({ name: 'changed_by_user_id', type: 'uuid' })
  changedByUserId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'changed_by_user_id' })
  changedByUser: UserEntity;

  @Column({ type: 'text', nullable: true })
  note?: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  timestamp: Date;
}
