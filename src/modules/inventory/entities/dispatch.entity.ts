import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany, CreateDateColumn } from 'typeorm';
import { WarehouseEntity } from './warehouse.entity';
import { EmployeeEntity } from '../../employees/entities/employee.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { DispatchLineEntity } from './dispatch-line.entity';
import { DispatchStatus } from '../enums/dispatch.enums';

/**
 * Despacho por Lotes / Manifiesto de Carga: agrupa la salida de herramientas,
 * equipos serializados y consumibles hacia un técnico en un solo documento con
 * estado propio, en vez de asignaciones individuales sueltas.
 *
 * No introduce custodia propia: al confirmarse (DISPATCHED), cada línea ejecuta
 * la transición real ya existente en EquipmentMovementService/ConsumableStockService.
 *
 * El despacho se asigna ÚNICAMENTE a un técnico (`technicianId`). El vehículo NO
 * es un campo de este despacho: es un bien de la empresa con su propia custodia,
 * y se registra/asigna como cualquier otra herramienta (categoría con
 * `articleType = TOOL_ASSET`, asignada al técnico vía `asignarATecnico`). Ver
 * "Vehículos como bien de la empresa" en el plan de implementación.
 */
@Entity({ schema: 'inv', name: 'dispatches' })
export class DispatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @ManyToOne(() => WarehouseEntity)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: WarehouseEntity;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @ManyToOne(() => EmployeeEntity)
  @JoinColumn({ name: 'technician_id' })
  technician: EmployeeEntity;

  @Column({ type: 'enum', enum: DispatchStatus, default: DispatchStatus.DRAFT })
  status: DispatchStatus;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: UserEntity;

  @Column({ name: 'dispatched_at', type: 'timestamp with time zone', nullable: true })
  dispatchedAt?: Date;

  @Column({ name: 'responded_at', type: 'timestamp with time zone', nullable: true })
  respondedAt?: Date;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 255, nullable: true })
  rejectionReason?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @OneToMany(() => DispatchLineEntity, (line) => line.dispatch)
  lines?: DispatchLineEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
