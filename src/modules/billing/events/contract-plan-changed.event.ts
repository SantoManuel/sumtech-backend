export class ContractPlanChangedEvent {
  contractId: string;
  clientId: string;
  contractNumber: string;
  oldPlanId: string;
  newPlanId: string;
  occurredOn: Date;
}
