import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PlatformUserEntity } from './platform-user.entity';
import { TenantEntity } from './tenant.entity';

// Auditoría del flujo "acceder como soporte" (Fase 6) — todo acceso de un
// SuperAdmin a datos de un tenant pasa por aquí, con motivo obligatorio.
@Entity({ schema: 'platform', name: 'support_access_sessions' })
export class SupportAccessSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'admin_id', type: 'uuid' })
  adminId: string;

  @ManyToOne(() => PlatformUserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id' })
  admin: PlatformUserEntity;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: TenantEntity;

  @Column({ type: 'text' })
  reason: string;

  @Column({ name: 'started_at', type: 'timestamp with time zone' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamp with time zone', nullable: true })
  endedAt?: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
