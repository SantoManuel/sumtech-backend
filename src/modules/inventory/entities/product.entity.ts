import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { SerialNumberEntity } from './serial-number.entity';
import { StockMovementEntity } from './stock-movement.entity';

@Entity({ schema: 'inv', name: 'products' })
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  sku: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ 
    type: 'enum', 
    enum: ['ROUTER_ONU', 'SET_TOP_BOX', 'FIBER_CABLE', 'CONNECTOR', 'ACCESSORY'],
    default: 'ROUTER_ONU' 
  })
  category: 'ROUTER_ONU' | 'SET_TOP_BOX' | 'FIBER_CABLE' | 'CONNECTOR' | 'ACCESSORY';

  @Column({ type: 'varchar', length: 50 })
  brand: string;

  @Column({ type: 'varchar', length: 50 })
  model: string;

  @Column({ name: 'cost_price', type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  costPrice: number;

  @Column({ name: 'sale_price', type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  salePrice: number;

  @Column({ name: 'stock_current', type: 'int', default: 0 })
  stockCurrent: number;

  @Column({ name: 'stock_minimum', type: 'int', default: 10 })
  stockMinimum: number;

  @Column({ name: 'requires_serial', type: 'boolean', default: true })
  requiresSerial: boolean;

  @OneToMany(() => SerialNumberEntity, (serial) => serial.product)
  serials?: SerialNumberEntity[];

  @OneToMany(() => StockMovementEntity, (movement) => movement.product)
  movements?: StockMovementEntity[];
}
