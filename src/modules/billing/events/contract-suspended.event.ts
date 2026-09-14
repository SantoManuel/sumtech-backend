export class ContractSuspendedEvent {
  contractId: string;
  clientId: string;
  contractNumber: string;
  daysOverdue: number;
  /** Motivo de negocio de la suspensión, para la auditoría de red (ver ProvisioningAuditLogEntity). */
  reason: string;
  occurredOn: Date;
}
