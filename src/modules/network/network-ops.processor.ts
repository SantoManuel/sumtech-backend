import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NETWORK_OPS_QUEUE, NETWORK_OPS_JOBS, RetryPendingOperationJobData } from './network-ops.constants';
import { ServiceControlService } from './service-control.service';

@Processor(NETWORK_OPS_QUEUE)
export class NetworkOpsProcessor extends WorkerHost {
  private readonly logger = new Logger(NetworkOpsProcessor.name);

  constructor(private readonly serviceControlService: ServiceControlService) {
    super();
  }

  async process(job: Job<RetryPendingOperationJobData>): Promise<any> {
    if (job.name === NETWORK_OPS_JOBS.RETRY_PENDING_OPERATION) {
      const { accessId, contractId, operation, attempt } = job.data;
      this.logger.log(
        `[BullMQ: network-ops] Procesando reintento #${attempt} de ${operation} para acceso ${accessId} (contrato ${contractId})`,
      );

      try {
        const result = await this.serviceControlService.applyPending(accessId);
        if (result.applied) {
          this.logger.log(
            `[BullMQ: network-ops] Operación ${operation} completada con éxito tras reintento para contrato ${contractId}.`,
          );
        } else {
          this.logger.warn(
            `[BullMQ: network-ops] Equipo aún no disponible para contrato ${contractId}: ${result.message}`,
          );
        }
        return result;
      } catch (err: any) {
        this.logger.error(
          `[BullMQ: network-ops] Error ejecutando reintento para contrato ${contractId}: ${err.message}`,
          err.stack,
        );
        throw err;
      }
    }
  }
}
