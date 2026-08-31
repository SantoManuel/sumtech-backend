import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { ProductEntity } from './product.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { EmployeeEntity } from '../../employees/entities/employee.entity';
import { TicketEntity } from '../../tickets/entities/ticket.entity';

/** Kardex de materiales a granel (no serializados): entradas, salidas a técnico, consumo y ajustes. */
@Entity({ schema: 'inv', name: 'stock_movements' })
export class StockMovementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => ProductEntity, (prod) => prod.movements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: ProductEntity;

  @Column({
    name: 'movement_type',
    type: 'enum',
    enum: [
      'IN_PURCHASE',
      'OUT_SALE',
      'OUT_INSTALLATION',
      'IN_REPAIR_RETURN',
      'ADJUSTMENT',
      'OUT_TO_TECHNICIAN',
      'IN_RETURN_FROM_TECHNICIAN',
      'OUT_CONSUMED_INSTALLATION',
    ],
  })
  movementType:
    | 'IN_PURCHASE'
    | 'OUT_SALE'
    | 'OUT_INSTALLATION'
    | 'IN_REPAIR_RETURN'
    | 'ADJUSTMENT'
    | 'OUT_TO_TECHNICIAN'
    | 'IN_RETURN_FROM_TECHNICIAN'
    | 'OUT_CONSUMED_INSTALLATION';

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'previous_stock', type: 'int' })
  previousStock: number;

  @Column({ name: 'new_stock', type: 'int' })
  newStock: number;

  @Column({ name: 'reference_id', type: 'varchar', length: 100, nullable: true })
  referenceId?: string; // ID de Venta, Ticket o Compra

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  /** Técnico involucrado (origen o destino, según movementType) cuando aplica a stock en campo. */
  @Column({ name: 'employee_id', type: 'uuid', nullable: true })
  employeeId?: string;

  @ManyToOne(() => EmployeeEntity, { nullable: true })
  @JoinColumn({ name: 'employee_id' })
  employee?: EmployeeEntity;

  @Column({ name: 'ticket_id', type: 'uuid', nullable: true })
  ticketId?: string;

  @ManyToOne(() => TicketEntity, { nullable: true })
  @JoinColumn({ name: 'ticket_id' })
  ticket?: TicketEntity;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
