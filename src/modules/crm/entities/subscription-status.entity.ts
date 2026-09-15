import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Catálogo editable de estados del pipeline comercial (Prospecto, En
 * Negociación, Suscripción Activa, Pérdida, y cualquier estado adicional que
 * un ADMIN/GERENTE agregue desde /dashboard/crm/configuracion). `code` es el
 * identificador estable que usa OpportunitiesService para las reglas de
 * negocio (cierre, motivo de pérdida obligatorio, etc.) — nunca cambia una
 * vez creado, aunque `name` sea editable.
 */
@Entity({ schema: 'crm', name: 'subscription_statuses' })
export class SubscriptionStatusEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 30, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}

/** Códigos con automatización de negocio propia — ver OpportunitiesService. */
export const SUBSCRIPTION_STATUS_CODE = {
  PROSPECTO: 'PROSPECTO',
  EN_NEGOCIACION: 'EN_NEGOCIACION',
  SUSCRIPCION_ACTIVA: 'SUSCRIPCION_ACTIVA',
  PERDIDA: 'PERDIDA',
} as const;
