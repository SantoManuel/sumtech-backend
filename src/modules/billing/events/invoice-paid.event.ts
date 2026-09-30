export class InvoicePaidEvent {
  invoiceId: string;
  contractId?: string;
  clientId: string;
  amount: number;
  paymentMethod?: string;
  paidAt: Date;
  occurredOn: Date;
}
