import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { ClientEntity } from '../../clients/entities/client.entity';

@Entity({ schema: 'com', name: 'client_notifications' })
export class ClientNotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({
    type: 'enum',
    enum: ['PAYMENT_REMINDER', 'PAYMENT_CONFIRMED', 'TICKET_UPDATE', 'MAINTENANCE', 'PROMOTION'],
    default: 'PAYMENT_REMINDER',
  })
  type: 'PAYMENT_REMINDER' | 'PAYMENT_CONFIRMED' | 'TICKET_UPDATE' | 'MAINTENANCE' | 'PROMOTION';

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  link?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
