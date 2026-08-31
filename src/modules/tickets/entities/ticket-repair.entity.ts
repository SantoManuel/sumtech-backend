import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { TicketEntity } from './ticket.entity';
import { SerialNumberEntity } from '../../inventory/entities/serial-number.entity';

@Entity({ schema: 'tickets', name: 'ticket_repairs' })
export class TicketRepairEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @ManyToOne(() => TicketEntity, (ticket) => ticket.repairs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: TicketEntity;

  @Column({ name: 'serial_removed_id', type: 'uuid' })
  serialRemovedId: string;

  @ManyToOne(() => SerialNumberEntity)
  @JoinColumn({ name: 'serial_removed_id' })
  serialRemoved: SerialNumberEntity;

  @Column({ name: 'serial_installed_id', type: 'uuid' })
  serialInstalledId: string;

  @ManyToOne(() => SerialNumberEntity)
  @JoinColumn({ name: 'serial_installed_id' })
  serialInstalled: SerialNumberEntity;

  @Column({ type: 'varchar', length: 255 })
  reason: string; // ej. 'Puerto PON dañado por sobretensión'

  @CreateDateColumn({ name: 'registered_at', type: 'timestamp with time zone' })
  registeredAt: Date;
}
