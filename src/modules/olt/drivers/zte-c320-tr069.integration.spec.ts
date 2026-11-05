import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { ZteTelnetSession } from './zte-telnet-session';
import { applyTr069ManagementWithSession } from './zte-c320-tr069';
import { tr069Input, tr069Snapshot } from './__fixtures__/tr069-state.fixture';
import { parseTr069State } from './zte-c320-tr069-state';
// Exercise the real session parser with a strict, in-process synthetic CLI, no network or OLT.
const { ZteC320Engine } = require('../../../../../sumtech-olt-emulator/src/engines/zte-c320.engine');

describe('TR069 session + CLI model integration', () => {
  it.each([false, true])('migrates observed VLAN and compensates a rejection (reject new tag: %s)', async rejected => {
    const prior = parseTr069State(tr069Snapshot(46), 'gpon-onu_1/2/15:1');
    const engine = new ZteC320Engine({ tr069: { transport: prior.transport, management: prior.management,
      rejections: rejected ? { 'tr069-mgmt 1 tag pri 2 vlan 50': '%Error 20202: Invalid parameter' } : {} } });
    const socket = new EventEmitter() as any;
    const cli = { currentMode: 'PRIVILEGED', contextData: {}, socket, clientIp: 'test' };
    socket.write = (input: string) => queueMicrotask(() => socket.emit('data', Buffer.from(input.trim() + '\r\n' + engine.processCommand(input.trim(), cli))));
    const session = new ZteTelnetSession({ host: '127.0.0.1', port: 23, username: 'test', password: 'test' });
    (session as any).socket = socket;
    const result = await applyTr069ManagementWithSession(session, tr069Input, new Logger('test'), async () => {});
    expect(result.ok).toBe(!rejected);
    expect(engine.tr069.transport).toContain(`service-port 2 vport 2 user-vlan ${rejected ? 46 : 50} vlan ${rejected ? 46 : 50}`);
    expect(engine.tr069.management).toContain(`flow 2 pri 2 vlan ${rejected ? 46 : 50}`);
    expect(engine.tr069.history).toContain('no flow 2 pri 2 vlan 46');
    expect(engine.tr069.transport).toContain('service-port 1 vport 1 user-vlan 400 vlan 400');
  });
  it.each([false, true])('reads modes, applies and persists (reject GEM: %s)', async rejected => {
    const engine = new ZteC320Engine({ tr069: { rejections: rejected ? { 'gemport 2 tcont 2': '%Error 20202: Invalid parameter' } : {} } });
    const socket = new EventEmitter() as any;
    const cli = { currentMode: 'PRIVILEGED', contextData: {}, socket, clientIp: 'test' };
    socket.write = (input: string) => {
      const command = input.trim();
      const output = engine.processCommand(command, cli);
      queueMicrotask(() => socket.emit('data', Buffer.from(command + '\r\n' + output)));
    };
    const session = new ZteTelnetSession({ host: '127.0.0.1', port: 23, username: 'test', password: 'test' });
    (session as any).socket = socket;
    const result = await applyTr069ManagementWithSession(session, tr069Input, new Logger('test'), async () => {});
    expect(result.ok).toBe(!rejected);
    expect(engine.tr069.history.some((cmd: string) => /^(?:reboot\b|(?:no )?ip dhcp snooping\b)/.test(cmd))).toBe(false);
    if (!rejected) {
      expect(engine.tr069.saved.transport).toContain('service-port 2 vport 2 user-vlan 50 vlan 50');
      expect(engine.tr069.saved.transport).toContain('service-port 1 vport 1 user-vlan 400 vlan 400');
      expect(result.evidence.omci.status).toBe('confirmed');
    } else expect(result.status).toBe('partial');
  });
});
