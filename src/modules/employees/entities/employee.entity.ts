import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn
} from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { CashStationEntity } from '../../pos/entities/cash-station.entity';

@Entity({ schema: 'sec', name: 'employees' })
export class EmployeeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Opcional — hay colaboradores sin acceso al sistema (ej. conserjería). Si
  // el usuario vinculado se elimina, el perfil de RRHH se conserva (user_id
  // pasa a NULL, no se borra la fila) — ver migración 034.
  @Column({ name: 'user_id', type: 'uuid', unique: true, nullable: true })
  userId?: string;

  @OneToOne(() => UserEntity, (user) => user.employee, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @Column({ type: 'varchar', length: 20, unique: true })
  cedula: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rnc?: string;

  @Column({ name: 'job_title', type: 'varchar', length: 100 })
  jobTitle: string; // ej. 'Técnico Instalador', 'Cajero POS'

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0.00 })
  salary: number;

  @Column({ name: 'hire_date', type: 'date' })
  hireDate: string;

  @Column({ name: 'photo_url', type: 'varchar', length: 255, nullable: true })
  photoUrl?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // Sucursal y caja por defecto — relevante sobre todo para CAJERO (se
  // preselecciona al abrir turno en el POS), pero disponible para cualquier
  // rol asignado a una sucursal física. Ambos opcionales: ADMIN/GERENTE y
  // roles 100% remotos (AGENTE_CRM) pueden no tener ninguno.
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId?: string;

  @ManyToOne(() => BranchEntity, { nullable: true })
  @JoinColumn({ name: 'branch_id' })
  branch?: BranchEntity;

  @Column({ name: 'default_cash_station_id', type: 'uuid', nullable: true })
  defaultCashStationId?: string;

  @ManyToOne(() => CashStationEntity, { nullable: true })
  @JoinColumn({ name: 'default_cash_station_id' })
  defaultCashStation?: CashStationEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
