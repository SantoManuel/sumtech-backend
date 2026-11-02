import { buildZteWanCommands, configureOnuWanWithSession, matchesZteWanConfiguration, parseZteWanConfiguration, validateOmciWanParams, verifyZteVlanProfile } from './zte-c320-wan';
import { ConfigureOnuWanParams } from '../ports/onu-wan.types';

const input: ConfigureOnuWanParams = {
  onuInterface: 'gpon-onu_1/2/1:4', serialNumber: 'HWTC1234', username: 'cliente@example', password: 'private-123!',
  profile: { oltId: 'olt-1', enabled: true, validation: 'PILOT', serialNumber: 'HWTC1234', oltFirmware: 'V2', onuFirmware: 'V1', vendorTypeName: 'HG8546M', vlanProfile: 'Internet400', serviceVlan: 400, wanIndex: 3, hostId: 1, auth: 'auto', evidence: 'Laboratorio de pruebas' },
};
const config = (line = '') => `pon-onu-mng ${input.onuInterface}\n ${line}\n!\npon-onu-mng gpon-onu_1/2/1:5\n wan-ip 3 mode dhcp\n!`;
const configured = config('wan-ip 3 mode pppoe username cliente@example password private-123! vlan-profile Internet400 host 1');
const detail = 'Serial number: HWTC1234\nType: HG8546M\nConfig state: success';
const vlanProfileOutput = 'Profile name: Internet400\nTag mode: tag\nCVLAN: 400\nCVLAN priority: 0';

describe('ZTE C320 OMCI WAN pilot recipe', () => {
  it('parses only the target block and redacts the password', () => {
    const result = parseZteWanConfiguration(configured, input.onuInterface, 3);
    expect(result).toMatchObject({ mode: 'pppoe', username: 'cliente@example', hostId: 1 });
    expect(JSON.stringify(result)).not.toContain(input.password);
    expect(result.evidence).toContain('password ***');
  });

  it('does not interpret unknown output as an absent WAN', () => {
    expect(() => parseZteWanConfiguration('ONU table not available', input.onuInterface, 3)).toThrow('no contiene');
  });

  it('rejects a named VLAN profile that maps to another service VLAN', () => {
    expect(() => verifyZteVlanProfile(vlanProfileOutput, 'Internet400', 401)).toThrow('no coincide');
    expect(() => verifyZteVlanProfile(vlanProfileOutput, 'Internet400', 400)).not.toThrow();
  });

  it.each(['injected\nwrite', 'bad;token', 'white space', '"quoted"'])('rejects unrepresentable credentials before I/O: %s', password => {
    expect(() => validateOmciWanParams({ ...input, password })).toThrow('caracteres');
  });

  it('applies the selected WAN index without deleting or reauthorizing an ONU', async () => {
    let reads = 0;
    const session: any = { executeCommand: jest.fn(async command => {
      if (command.startsWith('show gpon onu detail-info')) return detail;
      if (command === 'show gpon onu profile vlan') return vlanProfileOutput;
      if (command === 'show running-config') return reads++ ? configured : config();
      return '';
    }) };
    const result = await configureOnuWanWithSession(session, input);
    expect(result.status).toBe('APPLIED');
    const commands = session.executeCommand.mock.calls.map(c => c[0]);
    expect(commands).toContain('wan-ip 3 mode pppoe username cliente@example password private-123! vlan-profile Internet400 host 1');
    expect(commands).toContain('write');
    expect(commands.some(c => /^no onu|tr069-mgmt|reboot/.test(c))).toBe(false);
  });

  it('fails before writing when the physical slot belongs to a different serial', async () => {
    const session: any = { executeCommand: jest.fn().mockResolvedValue(detail.replace('HWTC1234', 'OTHER')) };
    await expect(configureOnuWanWithSession(session, input)).rejects.toThrow('no coincide');
    expect(session.executeCommand).toHaveBeenCalledTimes(1);
  });

  it('reports an uncertain outcome after a disconnect while writing and does not retry', async () => {
    const session: any = { executeCommand: jest.fn(async command => {
      if (command.startsWith('show gpon onu detail-info')) return detail;
      if (command === 'show gpon onu profile vlan') return vlanProfileOutput;
      if (command === 'show running-config') return config();
      if (command.startsWith('wan-ip')) throw new Error(`timeout password ${input.password}`);
      return '';
    }) };
    const result = await configureOnuWanWithSession(session, input);
    expect(result.status).toBe('UNKNOWN');
    expect(JSON.stringify(result)).not.toContain(input.password);
    expect(session.executeCommand.mock.calls.filter(c => c[0].startsWith('wan-ip'))).toHaveLength(1);
  });
});

describe('ZTE WAN service recipe supplied for Internet PPPoE', () => {
  const serviceInput: ConfigureOnuWanParams = {
    ...input,
    profile: { ...input.profile, commandStyle: 'WAN_SERVICE', vlanProfile: undefined, auth: undefined, ethUniPorts: '1-4', ssidPorts: '1-4' },
  };
  const lines = [
    'wan 3 ethuni 1-4 ssid 1-4 service internet',
    'wan 3 service internet host 1 pppoe',
    'pppoe 1 user cliente@example password private-123!',
    'pppoe 1 nat enable',
    'vlan wan 3 mode tag vlan 400',
  ];
  const dump = (commands: string[]) => `pon-onu-mng ${input.onuInterface}\n ${commands.join('\n ')}\n!`;
  const createSession = (after = dump(lines)) => {
    let reads = 0;
    return { executeCommand: jest.fn(async command => {
      if (command.startsWith('show gpon onu detail-info')) return detail;
      if (command === 'show running-config') return reads++ ? after : dump([]);
      return '';
    }) } as any;
  };

  it('generates bindings, host, credentials, NAT and VLAN as five separate commands', () => {
    expect(buildZteWanCommands(serviceInput)).toEqual(lines);
    expect(buildZteWanCommands(serviceInput).find(c => c.includes(' password '))).not.toContain(' nat enable');
  });

  it('sends standard command options without a lab registration or declared firmware', async () => {
    const automatic = { ...serviceInput, profile: { ...serviceInput.profile, validation: 'STANDARD' as const, vendorTypeName: '', onuFirmware: '', oltFirmware: '' } };
    const result = await configureOnuWanWithSession(createSession(), automatic);
    expect(result.status).toBe('APPLIED');
  });

  it('uses the configured VLAN, WAN index and PPP host instead of hardcoded example values', () => {
    expect(buildZteWanCommands({ ...serviceInput, profile: { ...serviceInput.profile, serviceVlan: 410, wanIndex: 4, hostId: 3, ethUniPorts: '1-2', ssidPorts: '2' } })).toEqual([
      'wan 4 ethuni 1-2 ssid 2 service internet', 'wan 4 service internet host 3 pppoe',
      'pppoe 3 user cliente@example password private-123!', 'pppoe 3 nat enable', 'vlan wan 4 mode tag vlan 410',
    ]);
  });

  it('applies the entire recipe, leaves management untouched and closes with end/write', async () => {
    const session = createSession();
    const result = await configureOnuWanWithSession(session, serviceInput);
    expect(result.status).toBe('APPLIED');
    const commands = session.executeCommand.mock.calls.map(c => c[0]);
    const start = commands.indexOf('configure terminal');
    expect(commands.slice(start, start + 9)).toEqual(['configure terminal', `pon-onu-mng ${input.onuInterface}`, ...lines, 'end', 'write']);
    expect(commands.some(c => /^(wan-ip|no |tr069-mgmt|reboot)/.test(c))).toBe(false);
    expect(commands).not.toContain('show gpon onu profile vlan');
    expect(JSON.stringify(result)).not.toContain(input.password);
  });

  it('parses a combined credentials/NAT readback and does not expose encrypted password data', () => {
    const observed = parseZteWanConfiguration(dump([lines[0], lines[1], 'pppoe 1 user cliente@example password encrypted PRIVATE_CIPHER nat enable', lines[4]]), input.onuInterface, 3);
    expect(matchesZteWanConfiguration(observed, serviceInput.profile, input.username)).toBe(true);
    expect(JSON.stringify(observed)).not.toContain('PRIVATE_CIPHER');
    expect(observed.evidence).toContain('password ***');
  });

  it('accepts expanded port lists in readback as equivalent to the requested ranges', () => {
    const observed = parseZteWanConfiguration(dump([lines[0].replace('ethuni 1-4 ssid 1-4', 'ethuni 1,2,3,4 ssid 1 2 3 4'), ...lines.slice(1)]), input.onuInterface, 3);
    expect(matchesZteWanConfiguration(observed, serviceInput.profile, input.username)).toBe(true);
  });

  it.each([
    ['NAT absent', lines.filter(l => !l.includes('nat enable'))],
    ['NAT disabled', lines.map(l => l.replace('nat enable', 'nat disable'))],
    ['different VLAN', lines.map(l => l.replace('vlan 400', 'vlan 401'))],
    ['different LAN binding', lines.map(l => l.replace('ethuni 1-4', 'ethuni 1-2'))],
    ['different SSID binding', lines.map(l => l.replace('ssid 1-4', 'ssid 1'))],
    ['different service', lines.map(l => l.replace('service internet host', 'service other host'))],
  ])('keeps the operation unconfirmed for %s', async (_name, output) => {
    const result = await configureOnuWanWithSession(createSession(dump(output)), serviceInput);
    expect(result.status).toBe('VERIFYING');
  });

  it.each(['4-1', '0', '1-5', '1\nwrite', '1;end'])('rejects invalid bindings before any CLI write: %s', ports => {
    expect(() => buildZteWanCommands({ ...serviceInput, profile: { ...serviceInput.profile, ethUniPorts: ports } })).toThrow();
  });

  it('stops at the first rejected WAN command and does not send the remaining commands', async () => {
    const session = createSession();
    const original = session.executeCommand.getMockImplementation();
    session.executeCommand.mockImplementation(async command => command === lines[3] ? '%Code 63993 : unknown ME' : original(command));
    const result = await configureOnuWanWithSession(session, serviceInput);
    expect(result.status).toBe('UNKNOWN');
    expect(result.warning).toContain('63993');
    expect(session.executeCommand.mock.calls.map(c => c[0])).not.toContain(lines[4]);
  });

  it('does not overwrite a PPP host already attached to another WAN', async () => {
    const session = createSession();
    session.executeCommand.mockImplementation(async command => command.startsWith('show gpon onu detail-info') ? detail : dump(['wan 4 service internet host 1 pppoe']));
    await expect(configureOnuWanWithSession(session, serviceInput)).rejects.toThrow('otra WAN');
    expect(session.executeCommand.mock.calls.map(c => c[0])).not.toContain('configure terminal');
  });

  it('does not mix WAN-IP and WAN service for an existing WAN', async () => {
    const session = createSession();
    session.executeCommand.mockImplementation(async command => command.startsWith('show gpon onu detail-info') ? detail : configured);
    await expect(configureOnuWanWithSession(session, serviceInput)).rejects.toThrow('otra receta');
  });
});
