import { ZteC320Driver } from './zte-c320.driver';

describe('ZTE mode switching', () => {
  const params = { host: '192.0.2.1', port: 23, username: 'test', password: 'test' };
  const config = { ponInterface: 'gpon-olt_1/1/1', onuId: 1, ethPorts: 1, serviceVlan: 400, operationMode: 'BRIDGE' as const };
  const management = 'switchport-bind switch_0/1 iphost 2\nvlan-filter iphost 2 pri 2 vlan 46';
  const router = 'switchport-bind switch_0/1 iphost 1\nvlan-filter iphost 1 pri 0 vlan 400\n' + management;
  const bridge = 'vlan port eth_0/1 mode tag vlan 400\n' + management;
  let driver: ZteC320Driver;
  let executeCommand: jest.Mock;
  let close: jest.Mock;
  function session(before: string, after = bridge, rejected = '') {
    let reads = 0;
    executeCommand = jest.fn(async (cmd: string) => cmd.startsWith('show ') ? (++reads === 1 ? before : after) : cmd === rejected ? '%Error 20202: Invalid input' : 'OLT#');
    close = jest.fn();
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({ connectAndLogin: jest.fn(), executeCommand, close });
  }
  beforeEach(() => { driver = new ZteC320Driver(); jest.spyOn<any, any>(driver, 'delay').mockResolvedValue(undefined); });
  it('switches and verifies without touching transport or management', async () => {
    session(router);
    expect(await driver.switchOnuOperationMode(params, config)).toMatchObject({ ok: true, changed: true, observed: { mode: 'bridge' } });
    expect(executeCommand.mock.calls.some(([c]) => /^(?:no )?(?:onu |tcont |gemport |service-port |tr069-mgmt )/.test(c))).toBe(false);
    expect(close).toHaveBeenCalled();
  });
  it('switches back to router', async () => {
    session(bridge, router);
    expect(await driver.switchOnuOperationMode(params, { ...config, operationMode: 'ROUTER' })).toMatchObject({ ok: true, observed: { mode: 'router' } });
  });
  it('does not resend an already applied mode', async () => {
    session(bridge);
    expect(await driver.switchOnuOperationMode(params, config)).toMatchObject({ ok: true, changed: false });
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });
  it.each(['', '%Error 20202: Invalid input', '!', router + '\nvlan port eth_0/1 mode tag vlan 400'])('rejects invalid or ambiguous reads', async raw => {
    session(raw);
    expect((await driver.switchOnuOperationMode(params, config)).ok).toBe(false);
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
  });
  it.each([router, bridge.replace('vlan 46', 'vlan 47')])('rejects a discrepant final read', async after => {
    session(router, after);
    expect(await driver.switchOnuOperationMode(params, config)).toMatchObject({ ok: false, changed: true });
  });
  it('treats bridge VLAN rejection as fatal and closes the session', async () => {
    session(router, bridge, 'vlan port eth_0/1 mode tag vlan 400');
    expect(await driver.switchOnuOperationMode(params, config)).toMatchObject({ ok: false, changed: true });
    expect(executeCommand).not.toHaveBeenCalledWith('write');
    expect(close).toHaveBeenCalled();
  });
  it('updates existing DHCP only with explicit support', async () => {
    session(router + '\ndhcp-ip ethuni eth_0/1 from-onu', bridge + '\ndhcp-ip ethuni eth_0/1 from-internet');
    expect((await driver.switchOnuOperationMode(params, { ...config, ethuniDhcpDelegationSupported: true })).ok).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith('dhcp-ip ethuni eth_0/1 from-internet');
  });
  it('does not use DHCP lines as proof of complete bridge VLAN mapping', async () => {
    session(router, bridge + '\ndhcp-ip ethuni eth_0/2 from-internet');
    expect((await driver.switchOnuOperationMode(params, { ...config, ethPorts: 2 })).ok).toBe(false);
  });
  it('does not touch an existing DHCP delegation without explicit capability', async () => {
    session(router + '\ndhcp-ip ethuni eth_0/1 from-onu');
    expect((await driver.switchOnuOperationMode(params, config)).ok).toBe(false);
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown port count before reading', async () => {
    session(router);
    expect((await driver.switchOnuOperationMode(params, { ...config, ethPorts: 0 })).ok).toBe(false);
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
