import { parseIpHost } from './zte-c320-parsers';

describe('parseIpHost', () => {
  it('does not attribute the service host address to management', () => {
    expect(parseIpHost('Host ID: 1\nCurrent IP address: 192.0.2.10')).toEqual({
      serviceIp: '192.0.2.10', mgmtIp: undefined, ipHostFound: false,
    });
  });

  it('does not attribute an unidentified address to management', () => {
    expect(parseIpHost('IP address: 192.0.2.10').mgmtIp).toBeUndefined();
  });

  it('reads each identified host independently', () => {
    expect(parseIpHost('Host ID: 1\nIP address: 192.0.2.10\nHost ID: 2\nCurrent IP address: 192.0.2.20')).toEqual({
      serviceIp: '192.0.2.10', mgmtIp: '192.0.2.20', ipHostFound: true,
    });
  });
});
