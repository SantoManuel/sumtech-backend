import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { SerialNumberEntity } from './serial-number.entity';
import { StockMovementEntity } from './stock-movement.entity';
import { CategoryEntity } from './category.entity';
import { SupplierEntity } from './supplier.entity';
import { WarehouseEntity } from './warehouse.entity';

@Entity({ schema: 'inv', name: 'products' })
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  sku: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId?: string;

  @ManyToOne(() => CategoryEntity, (category) => category.products, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category?: CategoryEntity;

  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId?: string;

  @ManyToOne(() => SupplierEntity, { nullable: true })
  @JoinColumn({ name: 'supplier_id' })
  supplier?: SupplierEntity;

  @Column({ name: 'default_warehouse_id', type: 'uuid', nullable: true })
  defaultWarehouseId?: string;

  @ManyToOne(() => WarehouseEntity, { nullable: true })
  @JoinColumn({ name: 'default_warehouse_id' })
  defaultWarehouse?: WarehouseEntity;

  @Column({ type: 'varchar', length: 50 })
  brand: string;

  @Column({ type: 'varchar', length: 50 })
  model: string;

  @Column({ name: 'unit_of_measure', type: 'varchar', length: 30, default: 'UNIDAD' })
  unitOfMeasure: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  barcode?: string;

  @Column({ name: 'manufacturer_code', type: 'varchar', length: 100, nullable: true })
  manufacturerCode?: string;

  @Column({ name: 'bin_location', type: 'varchar', length: 100, nullable: true })
  binLocation?: string;

  @Column({ name: 'warranty_months', type: 'int', default: 12 })
  warrantyMonths: number;

  @Column({ type: 'text', nullable: true })
  description?: string;

  /** Costo de adquisición unitario (RD$) */
  @Column({ name: 'cost_price', type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  costPrice: number;

  /** Valor de reposición / referencia operativa (RD$) */
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
