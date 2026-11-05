import { OltIoLockService } from './olt-io-lock.service';

describe('OLT physical I/O exclusion', () => {
  let service: OltIoLockService, runner: any, platform: any, tenant: any;
  beforeEach(() => {
    runner = { connect: jest.fn(), query: jest.fn().mockResolvedValue([{ locked: true }]), release: jest.fn(), isReleased: false };
    platform = { createQueryRunner: jest.fn().mockReturnValue(runner) };
    tenant = { getDataSource: () => ({ getRepository: () => ({ findOneBy: async () => ({ host: '10.0.0.2', port: 23, viaNodeId: 'router' }) }) }) };
    service = new OltIoLockService(platform, tenant);
  });
  it('uses physical endpoint identity instead of ONU/OLT row identifiers', async () => {
    await service.withLock('olt-alias', async () => service.withLock('same-physical-other-row', async () => 'done'));
    expect(platform.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_lock'), ['olt-io:router:10.0.0.2:23']);
    expect(runner.release).toHaveBeenCalled();
  });
  it('a broken lock connection blocks the next mutation', async () => {
    await service.withLock('olt', async () => {
      runner.query.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.assertOwned()).rejects.toThrow('connection lost');
    });
    expect(runner.release).toHaveBeenCalled();
  });
  it('preserves the operation error even when unlock fails', async () => {
    runner.query.mockResolvedValueOnce([{ locked: true }]).mockRejectedValueOnce(new Error('unlock lost'));
    await expect(service.withLock('olt', async () => { throw new Error('original failure'); })).rejects.toThrow('original failure');
    expect(runner.release).toHaveBeenCalled();
  });
});
