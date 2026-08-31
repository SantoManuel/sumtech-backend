export class SaleConfirmedEvent {
  saleId: string;
  clientId: string;
  planIds: string[];
  ncfNumber: string;
  grandTotal: number;
  occurredOn: Date;
}
