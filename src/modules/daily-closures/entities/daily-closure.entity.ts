import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, CreateDateColumn } from 'typeorm';
import { EmployeeEntity } from '../../employees/entities/employee.entity';
import { DailyClosureExpenseEntity } from './daily-closure-expense.entity';

/**
 * Jornada diaria del técnico de campo: se abre con "Iniciar Jornada"
 * (startedAt + ubicación GPS inicial opcional) y se cierra con el "Cierre de
 * caja chica diario" (combustible + gastos con foto — ver
 * DailyClosureExpenseEntity). Soporta múltiples jornadas/turnos por día
 * (solo se restringe a 1 jornada abierta simultáneamente mediante índice parcial).
 */
@Entity({ schema: 'tickets', name: 'daily_closures' })
export class DailyClosureEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => EmployeeEntity)
  @JoinColumn({ name: 'employee_id' })
  employee: EmployeeEntity;

  @Column({ name: 'closure_date', type: 'date' })
  closureDate: string;

  // Apertura de jornada — se fija al llamar POST /daily-closures/start.
  @Column({ name: 'started_at', type: 'timestamp with time zone' })
  startedAt: Date;

  @Column({ name: 'start_latitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  startLatitude?: number;

  @Column({ name: 'start_longitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  startLongitude?: number;

  // Cierre de jornada — nulo mientras la jornada está abierta (iniciada pero
  // aún no cerrada). El "Cierre de caja chica diario" exige que exista una
  // jornada abierta (startedAt) para ese día antes de poder cerrarla.
  @Column({ name: 'closed_at', type: 'timestamp with time zone', nullable: true })
  closedAt?: Date;

  @Column({ name: 'fuel_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  fuelAmount: number;

  // Foto de factura del combustible — igual exigencia de evidencia que cada
  // línea de DailyClosureExpenseEntity. Nullable solo por cierres históricos
  // previos a esta columna (nunca para cierres nuevos, el servicio lo exige).
  @Column({ name: 'fuel_receipt_photo_key', type: 'varchar', length: 500, nullable: true })
  fuelReceiptPhotoKey?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // Suma de DailyClosureExpenseEntity.amount al momento de cerrar la jornada —
  // se guarda para no tener que sumar las líneas en cada lectura de la lista.
  @Column({ name: 'total_expenses_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalExpensesAmount: number;

  @OneToMany(() => DailyClosureExpenseEntity, (expense) => expense.dailyClosure, { cascade: true })
  expenses: DailyClosureExpenseEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
