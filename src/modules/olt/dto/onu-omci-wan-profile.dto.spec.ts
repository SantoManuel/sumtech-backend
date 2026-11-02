import { validateSync } from 'class-validator';
import { OnuOmciWanProfileDto } from './onu-omci-wan-profile.dto';

const common = {
  oltId: '00000000-0000-4000-8000-000000000001', enabled: false, validation: 'PILOT',
  serialNumber: 'LAB0001', oltFirmware: 'V2', onuFirmware: 'V1', vendorTypeName: 'HG8546M',
  serviceVlan: 400, wanIndex: 1, hostId: 1, evidence: 'Laboratorio: script aportado por el operador.',
};
const errors = (profile: object) => validateSync(Object.assign(new OnuOmciWanProfileDto(), profile)).map(e => e.property);

describe('OMCI WAN recipe DTO compatibility', () => {
  it('accepts WAN service without a VLAN profile name or auth arguments', () => {
    expect(errors({ ...common, commandStyle: 'WAN_SERVICE', ethUniPorts: '1-4', ssidPorts: '1-4' })).toEqual([]);
  });
  it('keeps the existing WAN-IP payload valid when commandStyle is absent', () => {
    expect(errors({ ...common, vlanProfile: 'Internet400', auth: 'auto' })).toEqual([]);
  });
  it('requires LAN and SSID bindings for WAN service', () => {
    expect(errors({ ...common, commandStyle: 'WAN_SERVICE' })).toEqual(expect.arrayContaining(['ethUniPorts', 'ssidPorts']));
  });
  it('rejects invalid recipe names and injectable bindings', () => {
    expect(errors({ ...common, commandStyle: 'OTHER' })).toContain('commandStyle');
    expect(errors({ ...common, commandStyle: 'WAN_SERVICE', ethUniPorts: '1-4\nwrite', ssidPorts: '1-4' })).toContain('ethUniPorts');
  });
});
