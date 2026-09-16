import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Catálogo editable de próximas acciones comerciales (Llamar para
 * presentación, Enviar propuesta, etc.). `suggestedStatusCodes` alimenta una
 * sugerencia de UI (qué acciones mostrar primero según el estado actual de la
 * oportunidad) — no es una regla de negocio dura, un agente puede elegir
 * cualquier acción activa sin importar el estado.
 */
@Entity({ schema: 'crm', name: 'next_actions' })
export class NextActionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'suggested_status_codes', type: 'text', array: true, default: '{}' })
  suggestedStatusCodes: string[];

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}

export const NEXT_ACTION_CODE = {
  LLAMAR_PRESENTACION: 'LLAMAR_PRESENTACION',
  ENVIAR_PROPUESTA: 'ENVIAR_PROPUESTA',
  REUNION_CIERRE: 'REUNION_CIERRE',
  LLAMAR_SEGUIMIENTO: 'LLAMAR_SEGUIMIENTO',
  ENVIAR_ENCUESTA: 'ENVIAR_ENCUESTA',
} as const;
