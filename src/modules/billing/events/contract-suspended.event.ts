export class ContractSuspendedEvent {
  contractId: string;
  clientId: string;
  contractNumber: string;
  daysOverdue: number;
  /** Motivo de negocio de la suspensión, para la auditoría de red (ver ProvisioningAuditLogEntity). */
  reason: string;
  actor?: string;
  actorUserId?: string;
  occurredOn: Date;
}
