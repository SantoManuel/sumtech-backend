import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { DispatchEntity } from './dispatch.entity';
import { SerialNumberEntity } from './serial-number.entity';
import { ProductEntity } from './product.entity';
import { DispatchLineType } from '../enums/dispatch.enums';

/**
 * Una línea de un Despacho por Lotes: o bien un equipo/herramienta serializado
 * (`equipmentItemId`), o bien una cantidad de un consumible (`productId`+`quantity`).
 * La exclusividad (uno u otro, nunca ambos) se valida en DispatchService, siguiendo
 * el mismo criterio con el que InventoryService distingue producto serializado de
 * producto a granel.
 */
@Entity({ schema: 'inv', name: 'dispatch_lines' })
export class DispatchLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dispatch_id', type: 'uuid' })
  dispatchId: string;

  @ManyToOne(() => DispatchEntity, (dispatch) => dispatch.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispatch_id' })
  dispatch: DispatchEntity;

  @Column({ name: 'line_type', type: 'enum', enum: DispatchLineType })
  lineType: DispatchLineType;

  @Column({ name: 'equipment_item_id', type: 'uuid', nullable: true })
  equipmentItemId?: string | null;

  @ManyToOne(() => SerialNumberEntity, { nullable: true })
  @JoinColumn({ name: 'equipment_item_id' })
  equipmentItem?: SerialNumberEntity;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null;

  @ManyToOne(() => ProductEntity, { nullable: true })
  @JoinColumn({ name: 'product_id' })
  product?: ProductEntity;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  quantity?: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
