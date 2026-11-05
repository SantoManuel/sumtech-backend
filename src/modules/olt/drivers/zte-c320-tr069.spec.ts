import { Logger } from '@nestjs/common';
import { applyTr069ManagementWithSession, updateTr069AcsUrlWithSession } from './zte-c320-tr069';
import { buildTr069Plan, parseTr069State, validateTr069Input } from './zte-c320-tr069-state';
import { tr069Input, tr069Snapshot, tr069Session } from './__fixtures__/tr069-state.fixture';

describe('TR069 observed provisioning', () => {
  const logger = { warn: jest.fn(), log: jest.fn() } as unknown as Logger;
  const delay = jest.fn().mockResolvedValue(undefined);
  const iface = 'gpon-onu_1/2/15:1';
  beforeEach(() => jest.clearAllMocks());
  it('applies, reads back and saves without reboot or global DHCP', async () => {
    const session = tr069Session();
    const result = await applyTr069ManagementWithSession(session, tr069Input, logger, delay);
    expect(result).toMatchObject({ ok: true, status: 'applied_unverified', configurationStatus: 'confirmed', persistenceStatus: 'confirmed', rebootCount: 0 });
    expect(result.evidence.ip.status).toBe('confirmed');
    expect(result.evidence.acs.status).toBe('unknown');
    expect(session.rebootOnu).not.toHaveBeenCalled();
    expect(session.executeCommand).not.toHaveBeenCalledWith(expect.stringMatching(/^(?:reboot\b|(?:no )?ip dhcp snooping\b|no service-port 1\b)/), expect.anything());
  });
  it.each(['configure terminal', 'interface gpon-onu_1/2/15:1', 'tcont 2 profile SMARTOLT-VOIPMNG-10M', 'gemport 2 tcont 2', 'service-port 2 vport 2 user-vlan 50 vlan 50', 'pon-onu-mng gpon-onu_1/2/15:1', 'tr069-mgmt 1 acs ' + tr069Input.tr069Url, 'write'])('reports rejection of %s without blind retries', async reject => {
    const session = tr069Session({ reject });
    const result = await applyTr069ManagementWithSession(session, tr069Input, logger, delay);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('rechazó');
    expect(session.rebootOnu).not.toHaveBeenCalled();
    // A compensation can repeat a prior value; the rejected command itself is never blindly retried.
    expect(session.executeCommand.mock.calls.filter(([cmd]) => cmd === reject)).toHaveLength(1);
  });
  it('unknown readback never reports applied configuration', async () => {
    const result = await applyTr069ManagementWithSession(tr069Session({ after: '' }), tr069Input, logger, delay);
    expect(result.status).toBe('partial'); expect(result.ok).toBe(false);
  });
  it('empty OMCI evidence is visible instead of silent success', async () => {
    const result = await applyTr069ManagementWithSession(tr069Session({ detail: '', host: '' }), tr069Input, logger, delay);
    expect(result.status).toBe('applied_unverified'); expect(result.evidence.omci.status).toBe('unknown'); expect(result.warning).toBeTruthy();
  });
  it('does not mutate when the initial snapshot is empty, incomplete or belongs to another ONU', async () => {
    for (const before of ['', tr069Snapshot().replace('end', ''), tr069Snapshot().replace('TEST00000001', 'OTHER')]) {
      const session = tr069Session({ before });
      const result = await applyTr069ManagementWithSession(session, tr069Input, logger, delay);
      expect(result.status).toBe('failed'); expect(session.executeCommand).not.toHaveBeenCalledWith('configure terminal', expect.anything());
    }
  });
  it('migration deletes VLAN 46 rather than VLAN 50 and leaves Internet alone', () => {
    const plan = buildTr069Plan(tr069Input, parseTr069State(tr069Snapshot(46), iface, tr069Input.serialNumber));
    const commands = plan.map(s => s.command);
    expect(commands).toEqual(expect.arrayContaining(['no flow 2 pri 2 vlan 46', 'no vlan-filter iphost 2 pri 2 vlan 46', 'no tr069-mgmt 1 tag pri 2 vlan 46', 'service-port 2 vport 2 user-vlan 50 vlan 50']));
    expect(commands).not.toContain('no flow 2 pri 2 vlan 50');
    expect(commands.some(cmd => /(?:service-port|gemport|tcont|iphost) 1\b/.test(cmd))).toBe(false);
    expect(plan.find(s => s.command === 'no service-port 2')?.undo).toEqual(['service-port 2 vport 2 user-vlan 46 vlan 46']);
  });
  it('an equivalent configuration produces no mutations', () => {
    expect(buildTr069Plan(tr069Input, parseTr069State(tr069Snapshot(50), iface))).toEqual([]);
  });
  it('a transport channel with no management ownership evidence is not adopted', () => {
    const state = parseTr069State(tr069Snapshot(46), iface);
    state.management = [];
    expect(() => buildTr069Plan(tr069Input, state)).toThrow('acreditar');
  });
  it('resource 2 owned by another service fails preflight', () => {
    expect(() => buildTr069Plan(tr069Input, parseTr069State(tr069Snapshot(46).replace('gemport 2 tcont 2', 'gemport 2 tcont 1'), iface))).toThrow('otro servicio');
  });
  it('an indeterminate command stops all mutations and sanitizes the error', async () => {
    const session = tr069Session({ failIo: 'gemport 2 tcont 2' });
    const result = await applyTr069ManagementWithSession(session, { ...tr069Input, tr069AcsUsername: 'user', tr069AcsPassword: 'PRIVATE-ACS' }, logger, delay);
    expect(result.status).toBe('partial'); expect(JSON.stringify(result)).not.toContain('PRIVATE-ACS');
    expect(session.executeCommand).not.toHaveBeenCalledWith('write', expect.anything());
  });
  it('ACS-only changes no transport and follows the same readback/save policy', async () => {
    const session = tr069Session({ before: tr069Snapshot(50, 'http://old.example.test/'), after: tr069Snapshot(50) });
    const result = await updateTr069AcsUrlWithSession(session, tr069Input, logger, delay);
    expect(result.ok).toBe(true);
    expect(session.executeCommand).not.toHaveBeenCalledWith(expect.stringMatching(/^(?:no )?(?:tcont|gemport|service-port|flow|vlan-filter)/), expect.anything());
    expect(session.rebootOnu).not.toHaveBeenCalled();
  });
  it.each([{ tr069Vlan: 5000 }, { tr069Url: 'http://acs/\nreboot' }, { tr069AcsUsername: 'user' }])('rejects unsafe or incomplete input %j', change => {
    expect(() => validateTr069Input({ ...tr069Input, ...change })).toThrow();
  });
});
