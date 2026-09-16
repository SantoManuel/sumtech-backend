import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Fila única (id siempre 1, forzado por CHECK en la migración) que recuerda
 * el último usuario AGENTE_CRM al que se le asignó una oportunidad — permite
 * que el round robin rote de forma justa incluso entre reinicios del server.
 */
@Entity({ schema: 'crm', name: 'round_robin_cursor' })
export class RoundRobinCursorEntity {
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id: number;

  @Column({ name: 'last_assigned_user_id', type: 'uuid', nullable: true })
  lastAssignedUserId?: string;
}
