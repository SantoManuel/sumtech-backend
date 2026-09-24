import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Cargo de servicio puntual (instalación, reparación) cobrable desde el POS —
 * a diferencia de PlanEntity, NO es una suscripción recurrente: no tiene
 * velocidad, canales de TV ni CDT, y no se vincula a ContractEntity. Los
 * valores de `feeType` deben coincidir exactamente con el enum `itemType` de
 * SaleDetailEntity/CheckoutItemDto (POS) — agregar un tipo nuevo aquí no lo
 * habilita en el checkout si no se agrega también allá.
 */
@Entity({ schema: 'com', name: 'service_fees' })
export class ServiceFeeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'fee_type', type: 'enum', enum: ['INSTALLATION_FEE', 'REPAIR_FEE'] })
  feeType: 'INSTALLATION_FEE' | 'REPAIR_FEE';

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ name: 'itbis_rate', type: 'decimal', precision: 4, scale: 2, default: 0.18 })
  itbisRate: number;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
