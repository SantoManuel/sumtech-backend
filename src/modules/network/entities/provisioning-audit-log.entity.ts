import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { NetworkAccessEntity } from './network-access.entity';

/**
 * Registro inmutable de cada acción de aprovisionamiento ejecutada por
 * NetworkProvisioningService. Existe para poder responder "¿por qué a este
 * cliente le cortaron el servicio?" con datos reales, no con memoria — ver
 * riesgo "Cortar servicio es una acción de alto impacto" del plan de
 * integración con Mikrotik/RouterOS.
 */
@Entity({ schema: 'net', name: 'provisioning_audit_log' })
export class ProvisioningAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'access_id', type: 'uuid' })
  accessId: string;

  @ManyToOne(() => NetworkAccessEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'access_id' })
  access: NetworkAccessEntity;

  // Denormalizado a propósito: permite auditar/reportar por contrato sin
  // depender de que el acceso de red todavía exista.
  @Column({ name: 'contract_id', type: 'uuid' })
  contractId: string;

  @Column({
    type: 'enum',
    enum: ['CREATE', 'PROVISION', 'SUSPEND', 'RESTORE', 'DEPROVISION', 'SHADOW_CHECK', 'SYNC_PROFILE'],
  })
  action: 'CREATE' | 'PROVISION' | 'SUSPEND' | 'RESTORE' | 'DEPROVISION' | 'SHADOW_CHECK' | 'SYNC_PROFILE';

  @Column({
    type: 'enum',
    enum: ['OK', 'ERROR'],
  })
  result: 'OK' | 'ERROR';

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  // Motivo de NEGOCIO de la transición (ej. "Suspensión automática por
  // morosidad: 15 día(s) de atraso."), no el resultado técnico — ese ya está
  // en result/errorMessage. Null en acciones que no vienen de una transición
  // de estado comercial (CREATE, SYNC_PROFILE, SHADOW_CHECK).
  @Column({ name: 'reason', type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'varchar', length: 100, default: 'SYSTEM' })
  actor: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
