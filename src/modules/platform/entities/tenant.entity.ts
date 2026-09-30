import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { TenantStatus } from '../enums/tenant-status.enum';
import { SaasPlanEntity } from './saas-plan.entity';

@Entity({ schema: 'platform', name: 'tenants' })
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  // Nullable: el RNC puede no estar listo al momento del auto-registro (Fase 3);
  // se completa después desde CompanyProfileEntity/DGII config (Fase 4).
  @Column({ type: 'varchar', length: 20, nullable: true })
  rnc?: string;

  @Column({ type: 'varchar', length: 63, unique: true })
  slug: string;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.TRIAL })
  status: TenantStatus;

  // Nombre real de la base de datos Postgres de este tenant (ej. "tenant_ispazua"),
  // usado por TenantConnectionManagerService en la Fase 1 para resolver la conexión.
  @Column({ name: 'db_name', type: 'varchar', length: 100, unique: true })
  dbName: string;

  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId?: string;

  @ManyToOne(() => SaasPlanEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plan_id' })
  plan?: SaasPlanEntity;

  @Column({ name: 'trial_ends_at', type: 'timestamp with time zone', nullable: true })
  trialEndsAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
