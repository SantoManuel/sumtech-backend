import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { OnuTr069OperationsService, TR069_QUEUE, Tr069Job } from './onu-tr069-operations.service';
import { TenantConnectionManagerService } from '../../../common/tenancy/tenant-connection-manager.service';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { TenantStatus } from '../../platform/enums/tenant-status.enum';

@Processor(TR069_QUEUE, { concurrency: 1 })
export class OnuTr069Processor extends WorkerHost {
  constructor(private readonly operations: OnuTr069OperationsService, private readonly connections: TenantConnectionManagerService, private readonly context: TenantContextService) { super(); }
  async process(job: Job<Tr069Job>): Promise<void> {
    const tenant = await this.connections.resolveTenantBySlug(job.data.tenantSlug);
    if (!tenant || tenant.status !== TenantStatus.ACTIVE) throw new Error('Tenant de operación no disponible.');
    const dataSource = await this.connections.getDataSourceForTenant(tenant);
    await this.context.run({ tenantId: tenant.id, slug: tenant.slug, dataSource }, () => this.operations.process(job.data.operationId));
  }
}
