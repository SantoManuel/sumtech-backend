export class ContractTerminatedEvent {
  contractId: string;
  clientId: string;
  contractNumber: string;
  /** Motivo de negocio de la terminación, para la auditoría de red (ver ProvisioningAuditLogEntity). */
  reason: string;
  occurredOn: Date;
}
