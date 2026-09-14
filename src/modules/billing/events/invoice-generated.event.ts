export class InvoiceGeneratedEvent {
  invoiceId: string;
  clientId: string;
  contractId: string;
  concept: string;
  grandTotal: number;
  dueDate: string;
  occurredOn: Date;
}
