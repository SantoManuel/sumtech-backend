import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { SaleEntity } from './sale.entity';

@Entity({ schema: 'pos', name: 'sale_details' })
export class SaleDetailEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sale_id', type: 'uuid' })
  saleId: string;

  @ManyToOne(() => SaleEntity, (sale) => sale.details, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sale_id' })
  sale: SaleEntity;

  @Column({ 
    name: 'item_type', 
    type: 'enum', 
    enum: ['PLAN_SUBSCRIPTION', 'PLAN_ACTIVATION', 'PRODUCT_HARDWARE', 'INSTALLATION_FEE', 'REPAIR_FEE'], 
    default: 'PLAN_SUBSCRIPTION' 
  })
  itemType: 'PLAN_SUBSCRIPTION' | 'PLAN_ACTIVATION' | 'PRODUCT_HARDWARE' | 'INSTALLATION_FEE' | 'REPAIR_FEE';

  @Column({ name: 'item_id', type: 'uuid', nullable: true })
  itemId?: string; // ID de Plan o Producto

  @Column({ type: 'varchar', length: 200 })
  concept: string;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ name: 'itbis_amount', type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  itbisAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;
}
