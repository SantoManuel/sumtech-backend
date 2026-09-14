export class ContractReactivatedEvent {
  contractId: string;
  clientId: string;
  contractNumber: string;
  /** Motivo de negocio de la reactivación, para la auditoría de red (ver ProvisioningAuditLogEntity). */
  reason: string;
  occurredOn: Date;
}
