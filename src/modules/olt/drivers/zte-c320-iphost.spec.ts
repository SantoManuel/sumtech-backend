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


describe('management identity from IP-host', () => {
  it('uses the MAC of host 2 and ignores host 1 traffic identity', () => {
    const parsed = parseIpHost('Host ID: 1\nMAC address: 0000.0000.0000\nHost ID: 2\nDHCP enable: enable\nMAC address: 2cb2.7266.23eb\nCurrent IP address: 192.168.44.10');
    expect(parsed.managementMac).toBe('2CB2726623EB');
    expect(parsed.hosts).toContainEqual(expect.objectContaining({ hostId: 2, mac: '2CB2726623EB', currentIp: '192.168.44.10', dhcpEnabled: true }));
  });
  it('does not use a MAC from host 1 as management identity', () => {
    expect(parseIpHost('Host ID: 1\nMAC address: 2cb2.7266.23eb').managementMac).toBeUndefined();
  });
  it('does not select an identity from duplicate management host blocks', () => {
    const block = 'Host ID: 2\nMAC address: 2cb2.7266.23eb\n';
    expect(parseIpHost(block + block).managementMac).toBeUndefined();
  });
});
