export const NETWORK_OPS_QUEUE = 'network-ops';

export const NETWORK_OPS_JOBS = {
  RETRY_PENDING_OPERATION: 'retry-pending-operation',
};

export interface RetryPendingOperationJobData {
  accessId: string;
  contractId: string;
  operation: 'SUSPEND' | 'RESTORE' | 'DEPROVISION';
  attempt: number;
}
