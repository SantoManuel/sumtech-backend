import { OnuTr069Processor } from './onu-tr069.processor';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { TenantStatus } from '../../platform/enums/tenant-status.enum';

describe('TR069 worker tenant boundary', () => {
  it('restores tenant context before calling repositories', async () => {
    const context = new TenantContextService();
    const operations = { process: jest.fn(async (id: string) => { expect(id).toBe('operation'); expect(context.getTenantId()).toBe('tenant-id'); }) };
    const connections = { resolveTenantBySlug: jest.fn().mockResolvedValue({ id: 'tenant-id', slug: 'tenant', status: TenantStatus.ACTIVE }), getDataSourceForTenant: jest.fn().mockResolvedValue({}) };
    await new OnuTr069Processor(operations as any, connections as any, context).process({ data: { tenantSlug: 'tenant', operationId: 'operation' } } as any);
    expect(operations.process).toHaveBeenCalledTimes(1);
    expect(context.hasContext()).toBe(false);
  });
  it('rejects a disabled tenant without processing its operation', async () => {
    const operations = { process: jest.fn() };
    const connections = { resolveTenantBySlug: jest.fn().mockResolvedValue({ status: 'SUSPENDED' }), getDataSourceForTenant: jest.fn() };
    const worker = new OnuTr069Processor(operations as any, connections as any, new TenantContextService());
    await expect(worker.process({ data: { tenantSlug: 'tenant', operationId: 'operation' } } as any)).rejects.toThrow('Tenant');
    expect(operations.process).not.toHaveBeenCalled(); expect(connections.getDataSourceForTenant).not.toHaveBeenCalled();
  });
});
