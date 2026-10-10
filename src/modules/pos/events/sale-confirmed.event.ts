export class SaleConfirmedEvent {
  saleId: string;
  clientId: string;
  userId: string;
  planIds: string[];
  ncfNumber: string;
  grandTotal: number;
  occurredOn: Date;
}
