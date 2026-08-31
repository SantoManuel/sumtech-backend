import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  ManyToOne, 
  JoinColumn, 
  CreateDateColumn, 
  UpdateDateColumn 
} from 'typeorm';
import { EmployeeEntity } from '../../employees/entities/employee.entity';
import { UserEntity } from '../../users/entities/user.entity';

export type ScheduleEventType = 'REUNION' | 'FECHA_PAGO' | 'AVISO_GLOBAL' | 'MANTENIMIENTO_RED' | 'CAPACITACION';
export type ScheduleEventScope = 'GLOBAL' | 'DEPARTMENT' | 'EMPLOYEE';

@Entity({ schema: 'tickets', name: 'schedule_events' })
export class ScheduleEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ 
    type: 'enum', 
    enum: ['REUNION', 'FECHA_PAGO', 'AVISO_GLOBAL', 'MANTENIMIENTO_RED', 'CAPACITACION'], 
    default: 'REUNION' 
  })
  type: ScheduleEventType;

  @Column({ 
    type: 'enum', 
    enum: ['GLOBAL', 'DEPARTMENT', 'EMPLOYEE'], 
    default: 'GLOBAL' 
  })
  scope: ScheduleEventScope;

  @Column({ name: 'assigned_employee_id', type: 'uuid', nullable: true })
  assignedEmployeeId?: string;

  @ManyToOne(() => EmployeeEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_employee_id' })
  assignedEmployee?: EmployeeEntity;

  @Column({ name: 'event_date', type: 'date' })
  eventDate: string; // YYYY-MM-DD

  @Column({ name: 'start_time', type: 'varchar', length: 5, nullable: true })
  startTime?: string; // ej. '09:00'

  @Column({ name: 'duration_minutes', type: 'int', default: 60 })
  durationMinutes: number;

  @Column({ name: 'is_all_day', type: 'boolean', default: false })
  isAllDay: boolean;

  @Column({ type: 'varchar', length: 30, default: 'blue', nullable: true })
  color?: string;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
