import { configureOnuWanWithSession, parseZteWanConfiguration, validateOmciWanParams, verifyZteVlanProfile } from './zte-c320-wan';
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
