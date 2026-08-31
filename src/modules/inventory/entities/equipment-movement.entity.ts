import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { SerialNumberEntity } from './serial-number.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { TicketEntity } from '../../tickets/entities/ticket.entity';
import { EquipmentLocationType, EquipmentCondition, EquipmentMovementType } from '../enums/equipment.enums';

/**
 * Kardex inmutable (append-only) de cada cambio de custodia/condición de un
 * equipo serializado. Es la fuente de verdad para responder "¿dónde ha estado
 * este equipo y quién lo tuvo?".
 */
@Entity({ schema: 'inv', name: 'equipment_movements' })
export class EquipmentMovementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'equipment_item_id', type: 'uuid' })
  equipmentItemId: string;

  @ManyToOne(() => SerialNumberEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'equipment_item_id' })
  equipmentItem: SerialNumberEntity;

  @Column({ name: 'movement_type', type: 'enum', enum: EquipmentMovementType })
  movementType: EquipmentMovementType;

  @Column({ name: 'from_location_type', type: 'enum', enum: EquipmentLocationType, nullable: true })
  fromLocationType?: EquipmentLocationType;

  @Column({ name: 'from_warehouse_id', type: 'uuid', nullable: true })
  fromWarehouseId?: string | null;

  @Column({ name: 'from_employee_id', type: 'uuid', nullable: true })
  fromEmployeeId?: string | null;

  @Column({ name: 'from_client_id', type: 'uuid', nullable: true })
  fromClientId?: string | null;

  @Column({ name: 'from_contract_id', type: 'uuid', nullable: true })
  fromContractId?: string | null;

  @Column({ name: 'to_location_type', type: 'enum', enum: EquipmentLocationType })
  toLocationType: EquipmentLocationType;

  @Column({ name: 'to_warehouse_id', type: 'uuid', nullable: true })
  toWarehouseId?: string | null;

  @Column({ name: 'to_employee_id', type: 'uuid', nullable: true })
  toEmployeeId?: string | null;

  @Column({ name: 'to_client_id', type: 'uuid', nullable: true })
  toClientId?: string | null;

  @Column({ name: 'to_contract_id', type: 'uuid', nullable: true })
  toContractId?: string | null;

  @Column({ name: 'condition_before', type: 'enum', enum: EquipmentCondition, nullable: true })
  conditionBefore?: EquipmentCondition;

  @Column({ name: 'condition_after', type: 'enum', enum: EquipmentCondition })
  conditionAfter: EquipmentCondition;

  @Column({ name: 'ticket_id', type: 'uuid', nullable: true })
  ticketId?: string;

  @ManyToOne(() => TicketEntity, { nullable: true })
  @JoinColumn({ name: 'ticket_id' })
  ticket?: TicketEntity;

  @Column({ name: 'performed_by_user_id', type: 'uuid' })
  performedByUserId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'performed_by_user_id' })
  performedByUser: UserEntity;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
