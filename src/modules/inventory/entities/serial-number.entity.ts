import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, VersionColumn } from 'typeorm';
import { ProductEntity } from './product.entity';
import { ClientEntity } from '../../clients/entities/client.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { EmployeeEntity } from '../../employees/entities/employee.entity';
import { WarehouseEntity } from './warehouse.entity';
import { EquipmentLocationType, EquipmentCondition } from '../enums/equipment.enums';

@Entity({ schema: 'inv', name: 'serial_numbers' })
export class SerialNumberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => ProductEntity, (prod) => prod.serials, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: ProductEntity;

  @Column({ name: 'serial_number', type: 'varchar', length: 100, unique: true })
  serialNumber: string;

  /** Nulo para herramientas de trabajo (TOOL_ASSET): no tienen dirección MAC como un CPE. */
  @Column({ name: 'mac_address', type: 'varchar', length: 30, unique: true, nullable: true })
  macAddress?: string | null;

  /**
   * Estado heredado (un solo enum). Se recalcula automáticamente a partir de
   * locationType+condition en cada movimiento; se conserva solo para no romper
   * consumidores existentes (frontend, filtros legacy) mientras se migran.
   * La fuente de verdad real es locationType/condition.
   */
  @Column({
    type: 'enum',
    enum: ['AVAILABLE', 'RESERVED', 'ASSIGNED_TO_CLIENT', 'DAMAGED', 'IN_REPAIR'],
    default: 'AVAILABLE',
  })
  status: 'AVAILABLE' | 'RESERVED' | 'ASSIGNED_TO_CLIENT' | 'DAMAGED' | 'IN_REPAIR';

  @Column({
    name: 'location_type',
    type: 'enum',
    enum: EquipmentLocationType,
    default: EquipmentLocationType.WAREHOUSE,
  })
  locationType: EquipmentLocationType;

  @Column({ type: 'enum', enum: EquipmentCondition, default: EquipmentCondition.NEW })
  condition: EquipmentCondition;

  /**
   * Los 4 campos de custodia (warehouse/employee/client/contract) son mutuamente
   * excluyentes: solo uno debe estar poblado a la vez, según locationType. Deben
   * asignarse explícitamente con `null` (no `undefined`) para limpiarlos en cada
   * transición: TypeORM omite del UPDATE cualquier columna cuyo valor sea
   * `undefined`, dejando el valor anterior "fantasma" en la base de datos.
   */
  @Column({ name: 'current_warehouse_id', type: 'uuid', nullable: true })
  currentWarehouseId?: string | null;

  @ManyToOne(() => WarehouseEntity, { nullable: true })
  @JoinColumn({ name: 'current_warehouse_id' })
  currentWarehouse?: WarehouseEntity;

  @Column({ name: 'current_employee_id', type: 'uuid', nullable: true })
  currentEmployeeId?: string | null;

  @ManyToOne(() => EmployeeEntity, { nullable: true })
  @JoinColumn({ name: 'current_employee_id' })
  currentEmployee?: EmployeeEntity;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId?: string | null;

  @ManyToOne(() => ClientEntity, { nullable: true })
  @JoinColumn({ name: 'client_id' })
  client?: ClientEntity;

  @Column({ name: 'current_contract_id', type: 'uuid', nullable: true })
  currentContractId?: string | null;

  @ManyToOne(() => ContractEntity, { nullable: true })
  @JoinColumn({ name: 'current_contract_id' })
  currentContract?: ContractEntity;

  @Column({ name: 'assigned_at', type: 'timestamp with time zone', nullable: true })
  assignedAt?: Date;

  @Column({ name: 'last_movement_at', type: 'timestamp with time zone', nullable: true })
  lastMovementAt?: Date;

  @VersionColumn({ name: 'version' })
  version: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;
}
