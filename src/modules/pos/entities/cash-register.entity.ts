import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany, CreateDateColumn } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { SaleEntity } from './sale.entity';
import { CashStationEntity } from './cash-station.entity';

@Entity({ schema: 'pos', name: 'cash_registers' })
export class CashRegisterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'opening_amount', type: 'decimal', precision: 12, scale: 2 })
  openingAmount: number;

  @Column({ name: 'expected_closing_amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  expectedClosingAmount?: number;

  @Column({ name: 'real_closing_amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  realClosingAmount?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  difference?: number;

  @Column({ type: 'enum', enum: ['OPEN', 'CLOSED'], default: 'OPEN' })
  status: 'OPEN' | 'CLOSED';

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string;

  // Nullable: turnos históricos previos a la migración 053 y roles que operan
  // sin sucursal/caja asignada (ej. ADMIN cobrando desde "caja administrativa").
  @Column({ name: 'cash_station_id', type: 'uuid', nullable: true })
  cashStationId?: string;

  @ManyToOne(() => CashStationEntity, { nullable: true })
  @JoinColumn({ name: 'cash_station_id' })
  cashStation?: CashStationEntity;

  @OneToMany(() => SaleEntity, (sale) => sale.cashRegister)
  sales?: SaleEntity[];

  @CreateDateColumn({ name: 'opening_date', type: 'timestamp with time zone' })
  openingDate: Date;

  @Column({ name: 'closing_date', type: 'timestamp with time zone', nullable: true })
  closingDate?: Date;
}
