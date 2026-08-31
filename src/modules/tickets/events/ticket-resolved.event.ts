export class TicketResolvedEvent {
  ticketId: string;
  clientId: string;
  contractId?: string;
  type: string;
  resolvedAt: Date;
}
