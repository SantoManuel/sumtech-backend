import { OnuTr069OperationsService, ipInManagementCidr } from './onu-tr069-operations.service';
import { OnuTr069OperationEntity } from '../entities/onu-tr069-operation.entity';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { tr069Input } from '../drivers/__fixtures__/tr069-state.fixture';
import { initialTr069Result, evidence } from '../ports/tr069-provisioning.types';
import { decryptSecretSafe, encryptSecret } from '../../../common/utils/secret-crypto.util';

describe('Durable TR069 operations', () => {
  let service: OnuTr069OperationsService;
  let rows: any[], config: any, queue: any, management: any, operations: any, audit: any, acs: any;
  const request = { tr069NetworkId: 'network', tr069AcsUsername: 'testuser', tr069AcsPassword: 'PRIVATE-ACS' };
  const prepared = { auth: { ...tr069Input, tr069AcsUsername: request.tr069AcsUsername, tr069AcsPassword: request.tr069AcsPassword }, oltId: 'olt', networkId: 'network', vlanId: 'vlan', cidr: '10.50.0.0/24', kind: 'profile' };
  const tenant = { getTenantId: () => 'tenant-1', getSlug: () => 'tenant-one', getDataSource: () => ({ transaction: async (fn: any) => fn(manager) }) };
  let manager: any;
  beforeEach(() => {
    process.env.COMPANY_SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.GENIEACS_CWMP_URL = tr069Input.tr069Url;
    rows = []; config = { onuId: 'onu', desiredVersion: 3, appliedVersion: 3 };
    operations = {
      findOneBy: jest.fn(async (q: any) => rows.find(row => (!q.id || row.id === q.id) && (!q.onuId || row.onuId === q.onuId) && (!q.status || ['queued', 'running'].includes(row.status)))),
      createQueryBuilder: jest.fn(() => {
        let criteria: any;
        const builder: any = { addSelect: () => builder, where: (_: any, q: any) => { criteria = q; return builder; },
          getOne: async () => rows.find(row => criteria.id ? row.id === criteria.id : row.onuId === criteria.onuId && row.requestKey === criteria.key) };
        return builder;
      }),
      save: jest.fn(async (row: any) => { row.createdAt = new Date(); rows.push(row); return row; }),
      update: jest.fn(async (criteria: any, change: any) => {
        const row = rows.find(row => typeof criteria === 'string' ? row.id === criteria : row.id === criteria.id && row.status === criteria.status);
        if (row) Object.assign(row, change);
        return { affected: row ? 1 : 0 };
      }),
      find: jest.fn(async () => []),
    };
    const configs = { findOne: jest.fn(async () => config), findOneBy: jest.fn(async () => config), save: jest.fn(async (row: any) => row),
      update: jest.fn(async (where: any, change: any) => { if (config.desiredVersion === where.desiredVersion) Object.assign(config, change); }), create: (row: any) => row };
    manager = { getRepository: (entity: any) => entity === OnuTr069OperationEntity ? operations : configs };
    queue = { getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue(undefined) };
    const result = { ...initialTr069Result(), ok: true, status: 'applied_unverified', configurationStatus: 'confirmed', persistenceStatus: 'confirmed' };
    result.evidence.omci = evidence('confirmed', 'test'); result.evidence.ip = evidence('confirmed', 'test', 'IP de gestión: 10.50.0.2');
    management = { prepareTr069Operation: jest.fn().mockResolvedValue(prepared), executePreparedTr069: jest.fn().mockResolvedValue(result), findById: jest.fn().mockResolvedValue({ olt: { id: 'olt' } }) };
    management.observeTr069Operation = jest.fn().mockResolvedValue(prepared.cidr);
    audit = { logEvent: jest.fn() };
    acs = { findDeviceBySerial: jest.fn().mockResolvedValue('device'), getDeviceStatus: jest.fn().mockResolvedValue({ serialNumber: tr069Input.serialNumber, lastInformAt: new Date(Date.now() + 1000), tags: ['tenant:tenant-one'] }) };
    service = new OnuTr069OperationsService(operations, configs as any, queue, management, { withMutation: (_: any, fn: any) => fn() } as any, tenant as any,
      { runForEachActiveTenant: async (_: any, fn: any) => fn() } as any, acs, audit);
  });
  afterEach(() => { delete process.env.COMPANY_SECRETS_ENCRYPTION_KEY; delete process.env.GENIEACS_CWMP_URL; });
  it('persists encrypted intent before queueing only references', async () => {
    const response = await service.create('onu', request, 'profile', undefined, 'request-1');
    expect(queue.add).toHaveBeenCalledWith('apply', { tenantSlug: 'tenant-one', operationId: response.operationId }, expect.anything());
    expect(rows[0].payloadEnc).not.toContain('PRIVATE-ACS');
    expect(decryptSecretSafe(rows[0].payloadEnc)).toContain('PRIVATE-ACS');
    expect(JSON.stringify(response)).not.toContain('PRIVATE-ACS'); expect(config.desiredVersion).toBe(4);
  });
  it('a duplicate request reserves one version, and another payload conflicts', async () => {
    const a = await service.create('onu', request, 'profile', undefined, 'same');
    const b = await service.create('onu', request, 'profile', undefined, 'same');
    expect(a.operationId).toBe(b.operationId); expect(rows).toHaveLength(1); expect(config.desiredVersion).toBe(4);
    await expect(service.create('onu', { ...request, tr069AcsPassword: 'OTHER' }, 'profile', undefined, 'same')).rejects.toThrow('otra solicitud');
  });
  it('Redis failure retains a queued outbox row for recovery', async () => {
    queue.add.mockRejectedValue(new Error('Redis unavailable'));
    await expect(service.create('onu', request, 'profile', undefined, 'request-1')).resolves.toHaveProperty('operationId');
    expect(rows[0].status).toBe('queued'); expect(rows[0].payloadEnc).toBeTruthy();
  });
  it('an idempotent retry can return the operation while the ONU lock is held', async () => {
    const op = await service.create('onu', request, 'profile', undefined, 'same');
    (service as any).wan.withMutation = jest.fn().mockRejectedValue(new Error('ONU occupied'));
    await expect(service.create('onu', request, 'profile', undefined, 'same')).resolves.toHaveProperty('operationId', op.operationId);
  });
  it('expires encrypted credentials from the database even if Redis is down', async () => {
    const op = await service.create('onu', request, 'profile'); rows[0].expiresAt = new Date(0);
    operations.find.mockResolvedValueOnce([rows[0]]);
    queue.add.mockRejectedValue(new Error('Redis unavailable'));
    await service.recover();
    expect(rows[0].payloadEnc).toBeNull(); expect(rows[0].status).toBe('failed'); expect(config.applyStatus).toBe('ERROR');
    expect(management.executePreparedTr069).not.toHaveBeenCalled();
  });
  it('successful configuration needs a fresh Inform and tenant match before verified', async () => {
    const op = await service.create('onu', request, 'profile');
    await service.process(op.operationId);
    expect(rows[0].status).toBe('verified'); expect(rows[0].payloadEnc).toBeNull(); expect(config.appliedVersion).toBe(4);
    expect(JSON.stringify(audit.logEvent.mock.calls)).not.toContain('PRIVATE-ACS');
    await service.process(op.operationId); expect(management.executePreparedTr069).toHaveBeenCalledTimes(1);
  });
  it.each(['old', 'other-tenant', 'other-serial', 'other-acs'])('does not verify %s evidence', async reason => {
    if (reason === 'other-acs') process.env.GENIEACS_CWMP_URL = 'http://other.test/';
    acs.getDeviceStatus.mockResolvedValue({ serialNumber: reason === 'other-serial' ? 'OTHER' : tr069Input.serialNumber,
      lastInformAt: new Date(reason === 'old' ? 0 : Date.now() + 1000), tags: reason === 'other-tenant' ? ['tenant:other'] : ['tenant:tenant-one'] });
    const op = await service.create('onu', request, 'profile'); await service.process(op.operationId);
    expect(rows[0].status).toBe('applied_unverified'); expect(rows[0].nextCheckAt).toBeInstanceOf(Date);
  });
  it('a changed desired version prevents obsolete I/O', async () => {
    const op = await service.create('onu', request, 'profile'); config.desiredVersion++;
    await service.process(op.operationId);
    expect(management.executePreparedTr069).not.toHaveBeenCalled(); expect(rows[0].status).toBe('failed');
  });
  it('tenant/operation bound ciphertext cannot be replayed', async () => {
    const op = await service.create('onu', request, 'profile');
    rows[0].payloadEnc = encryptSecret(JSON.stringify({ tenantId: 'other', operationId: op.operationId, prepared }));
    await service.process(op.operationId);
    expect(management.executePreparedTr069).not.toHaveBeenCalled(); expect(rows[0].payloadEnc).toBeNull();
  });
  it('an expired queued intent is cleared without device access', async () => {
    const op = await service.create('onu', request, 'profile'); rows[0].expiresAt = new Date(0);
    await service.process(op.operationId);
    expect(management.executePreparedTr069).not.toHaveBeenCalled(); expect(rows[0].status).toBe('failed');
  });
  it('failure cannot advance appliedVersion or log complete success', async () => {
    management.executePreparedTr069.mockResolvedValue({ ...initialTr069Result(), status: 'partial', error: 'GEM rechazado.' });
    const op = await service.create('onu', request, 'profile'); await service.process(op.operationId);
    expect(config.appliedVersion).toBe(3); expect(rows[0].status).toBe('partial');
    expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILURE' }));
  });
  it('verification reconciliation only reads and cannot reapply configuration', async () => {
    const op = await service.create('onu', request, 'profile');
    acs.getDeviceStatus.mockResolvedValueOnce({ serialNumber: tr069Input.serialNumber, lastInformAt: new Date(0), tags: ['tenant:tenant-one'] });
    await service.process(op.operationId);
    operations.find.mockResolvedValueOnce([]).mockResolvedValueOnce([rows[0]]);
    await service.recover();
    expect(management.observeTr069Operation).toHaveBeenCalled();
    expect(management.executePreparedTr069).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe('verified');
  });
  it('redelivery after an interrupted worker always re-observes the device', async () => {
    const op = await service.create('onu', request, 'profile');
    rows[0].status = 'running'; rows[0].attempts = 1;
    await service.process(op.operationId);
    expect(management.executePreparedTr069).toHaveBeenCalledTimes(1);
    expect(rows[0].attempts).toBe(2);
  });
  it.each([['10.50.0.2', '10.50.0.0/24', true], ['10.51.0.2', '10.50.0.0/24', false], ['999.1.1.1', '0.0.0.0/0', false], ['10.50.0.2', 'invalid', false]])('checks CIDR %s %s', (ip, cidr, expected) => expect(ipInManagementCidr(ip, cidr)).toBe(expected));
});
