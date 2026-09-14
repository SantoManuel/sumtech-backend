import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { DailyClosureEntity } from './daily-closure.entity';

@Entity({ schema: 'tickets', name: 'daily_closure_expenses' })
export class DailyClosureExpenseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'daily_closure_id', type: 'uuid' })
  dailyClosureId: string;

  @ManyToOne(() => DailyClosureEntity, (closure) => closure.expenses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'daily_closure_id' })
  dailyClosure: DailyClosureEntity;

  @Column({ type: 'varchar', length: 150 })
  concept: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  // Object key en el bucket de MinIO (no una URL pública) — se resuelve a una
  // URL firmada bajo demanda vía MinioStorageService.getPresignedUrl.
  @Column({ name: 'receipt_photo_key', type: 'varchar', length: 500 })
  receiptPhotoKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
