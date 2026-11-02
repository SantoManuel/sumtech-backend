import { CpeWanPolicyService, isWanParameter } from './cpe-wan-policy.service';

describe('CpeWanPolicyService', () => {
  let policy: CpeWanPolicyService;
  let query: jest.Mock;
  let runner: any;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([{ id: 'onu-1' }]);
    runner = { connect: jest.fn(), query: jest.fn().mockResolvedValue([{ locked: true }]), release: jest.fn() };
    policy = new CpeWanPolicyService({ getTenantId: () => 'tenant-1', getDataSource: () => ({ query, createQueryRunner: () => runner }) } as any);
  });

  it.each(['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password', 'Device.PPP.Interface.1.Username', 'Device.IP.Interface.1.Enable'])('recognizes a WAN writer: %s', path => {
    expect(isWanParameter(path)).toBe(true);
  });
  it('permits independent Wi-Fi writes without a WAN lock', async () => {
    const action = jest.fn().mockResolvedValue('ok');
    await expect(policy.withDeviceWrite('device-1', ['Device.WiFi.SSID.1.SSID'], action)).resolves.toBe('ok');
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects ACS WAN writes to an OMCI-owned ONU', async () => {
    query.mockResolvedValueOnce([{ id: 'onu-1' }]).mockResolvedValueOnce([{ wan_provisioning_method: 'OMCI' }]);
    const action = jest.fn();
    await expect(policy.withDeviceWrite('device-1', ['Device.PPP.Interface.1.Username'], action)).rejects.toThrow('OMCI');
    expect(action).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });
  it('fails closed for ambiguous/unlinked device identities', async () => {
    query.mockResolvedValue([]);
    await expect(policy.withDeviceWrite('unlinked', ['Device.PPP.Interface.1.Username'], jest.fn())).rejects.toThrow('única ONU');
  });

  it('blocks an ad-hoc PPP write that bypasses a versioned WAN intent', async () => {
    query.mockResolvedValueOnce([{ id: 'onu-1' }]).mockResolvedValueOnce([{ wan_provisioning_method: 'TR069', wan_desired_version: 4 }]);
    await expect(policy.withDeviceWrite('device-1', ['Device.PPP.Interface.1.Username'], jest.fn())).rejects.toThrow('versionada');
  });

  it('allows its orchestrator to write the current version under the shared lock', async () => {
    query.mockResolvedValueOnce([{ id: 'onu-1' }]).mockResolvedValueOnce([{ wan_provisioning_method: 'TR069', wan_desired_version: 4 }]);
    const action = jest.fn().mockResolvedValue('ok');
    await expect(policy.withManagedWrite('onu-1', 'TR069', 4, () => policy.withDeviceWrite('device-1', ['Device.PPP.Interface.1.Username'], action))).resolves.toBe('ok');
  });
  it('refuses a concurrent writer and releases the database connection', async () => {
    runner.query.mockResolvedValue([{ locked: false }]);
    const action = jest.fn();
    await expect(policy.withOnu('onu-1', action)).rejects.toThrow('otra operación');
    expect(action).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });
  it('supports reentrant calls in the same request while releasing a failed outer writer', async () => {
    await expect(policy.withOnu('onu-1', () => policy.withOnu('onu-1', async () => { throw new Error('failure'); }))).rejects.toThrow('failure');
    expect(runner.query).toHaveBeenCalledTimes(2);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
});
