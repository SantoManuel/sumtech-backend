import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { BranchEntity } from '../../branches/entities/branch.entity';

/**
 * Caja física dentro de una sucursal (ej. "Caja 1", "Caja Recepción") — a
 * diferencia de CashRegisterEntity (el turno individual de un cajero), esta
 * entidad persiste entre turnos: es "dónde", no "cuándo/quién".
 */
@Entity({ schema: 'pos', name: 'cash_stations' })
export class CashStationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId: string;

  @ManyToOne(() => BranchEntity)
  @JoinColumn({ name: 'branch_id' })
  branch: BranchEntity;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
