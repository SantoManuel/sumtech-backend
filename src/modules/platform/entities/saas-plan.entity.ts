import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'platform', name: 'saas_plans' })
export class SaasPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'monthly_price', type: 'decimal', precision: 12, scale: 2 })
  monthlyPrice: number;

  @Column({ name: 'max_users', type: 'int', nullable: true })
  maxUsers?: number;

  @Column({ name: 'max_clients', type: 'int', nullable: true })
  maxClients?: number;

  @Column({ type: 'jsonb', default: {} })
  features: Record<string, unknown>;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
