/**
 * ARCHIVO: src/modules/coordination/events/ticket-resolved.event.ts
 * CAPA: Evento de Dominio (Asíncrono)
 * 
 * RESPONSABILIDAD:
 * - Transporta la notificación de que una orden técnica fue resuelta en campo.
 * 
 * PROPIEDADES:
 * - ticketId: string
 * - ticketType: 'INSTALLATION' | 'REPAIR_FAULT' | 'MAINTENANCE'
 * - contractId?: string
 * - clientId: string
 * - resolvedByUserId: string
 * - timestamp: Date
 */
export class TicketResolvedEvent {
  constructor(
    public readonly ticketId: string,
    public readonly ticketType: string,
    public readonly contractId: string | undefined,
    public readonly clientId: string,
    public readonly resolvedByUserId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
