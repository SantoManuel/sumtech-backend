export class PaymentReminderEvent {
  invoiceId: string;
  clientId: string;
  contractId?: string;
  concept: string;
  grandTotal: number;
  dueDate: string;
  kind: 'ADVANCE' | 'OVERDUE';
  daysOverdue?: number;
  occurredOn: Date;
}
