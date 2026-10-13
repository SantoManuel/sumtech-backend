import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Cargo de servicio puntual (instalación, reparación) cobrable desde el POS —
 * a diferencia de PlanEntity, NO es una suscripción recurrente: no tiene
 * velocidad ni canales de TV, y no se vincula a ContractEntity. Los
 * valores de `feeType` deben coincidir exactamente con el enum `itemType` de
 * SaleDetailEntity/CheckoutItemDto (POS) — agregar un tipo nuevo aquí no lo
 * habilita en el checkout si no se agrega también allá.
 *
 * `cdtRate`/`iscRate` default en 0: a diferencia de la mensualidad de un plan,
 * no hay consenso legal único sobre si un cargo de instalación o reparación es
 * "servicio de telecomunicaciones" a efectos de CDT/ISC — queda a criterio de
 * cada ISP, configurable aquí por tipo de cargo (ver Plan_Implementacion_CDT_ISC_Impuestos.md).
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

  @Column({ name: 'cdt_rate', type: 'decimal', precision: 4, scale: 2, default: 0 })
  cdtRate: number;

  @Column({ name: 'isc_rate', type: 'decimal', precision: 4, scale: 2, default: 0 })
  iscRate: number;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
