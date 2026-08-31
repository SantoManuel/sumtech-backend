import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, UpdateDateColumn, Unique } from 'typeorm';
import { ProductEntity } from './product.entity';
import { EmployeeEntity } from '../../employees/entities/employee.entity';

/**
 * Existencia de un material a granel (no serializado) en poder de un técnico.
 * El stock en almacén central sigue viviendo en ProductEntity.stockCurrent;
 * esta tabla solo representa lo que cada técnico lleva consigo.
 */
@Entity({ schema: 'inv', name: 'stock_items' })
@Unique('uq_stock_items_product_employee', ['productId', 'employeeId'])
export class StockItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: ProductEntity;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => EmployeeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: EmployeeEntity;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  quantity: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
