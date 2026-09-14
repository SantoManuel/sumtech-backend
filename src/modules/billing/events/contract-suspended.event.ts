export class ContractSuspendedEvent {
  contractId: string;
  clientId: string;
  contractNumber: string;
  daysOverdue: number;
  occurredOn: Date;
}
