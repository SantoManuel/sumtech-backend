import { detectOnuMode } from './zte-c320-mode-detector';

describe('detectOnuMode', () => {
  const bridgeFixture = `
pon-onu-mng gpon-onu_1/2/15:1
  flow 1 switch switch_0/1
  flow mode 1 tag-filter vlan-filter untag-filter discard
  flow 1 pri 0 vlan 400
  gemport 1 flow 1
  switchport-bind switch_0/1 iphost 2
  switchport-bind switch_0/1 veip 1
  ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable
  vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard
  vlan-filter iphost 2 pri 2 vlan 46
  vlan port eth_0/1 mode tag vlan 400
  vlan port eth_0/2 mode tag vlan 400
  vlan port eth_0/3 mode tag vlan 400
  vlan port eth_0/4 mode tag vlan 400
  dhcp-ip ethuni eth_0/1 from-internet
  dhcp-ip ethuni eth_0/2 from-internet
  dhcp-ip ethuni eth_0/3 from-internet
  dhcp-ip ethuni eth_0/4 from-internet
  security-mgmt 998 state enable mode forward ingress-type lan protocol web https
  security-mgmt 999 state enable ingress-type lan protocol tr069
!
`;

  const routerFixture = `
pon-onu-mng gpon-onu_1/2/15:1
  flow 1 switch switch_0/1
  flow mode 1 tag-filter vlan-filter untag-filter discard
  flow 1 pri 0 vlan 400
  gemport 1 flow 1
  switchport-bind switch_0/1 iphost 1
  switchport-bind switch_0/1 iphost 2
  switchport-bind switch_0/1 veip 1
  ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable
  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard
  vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard
  vlan-filter iphost 1 pri 0 vlan 400
  vlan-filter iphost 2 pri 2 vlan 46
  dhcp-ip ethuni eth_0/1 from-onu
  dhcp-ip ethuni eth_0/2 from-onu
  dhcp-ip ethuni eth_0/3 from-onu
  dhcp-ip ethuni eth_0/4 from-onu
  security-mgmt 998 state enable mode forward ingress-type lan protocol web https
  security-mgmt 999 state enable ingress-type lan protocol tr069
!
`;

  it('detecta correctamente modo Bridge de fixture real Huawei HG8546M', () => {
    const res = detectOnuMode(bridgeFixture);
    expect(res.mode).toBe('bridge');
    expect(res.confidence).toBe('high');
    expect(res.internetVlan).toBe(400);
    expect(res.managementVlan).toBe(46);
    expect(res.internetIpHost).toBeUndefined();
    expect(res.managementIpHost).toBe(2);
    expect(res.dhcpSource).toBe('from-internet');
    expect(res.ethPortsDetected).toEqual([1, 2, 3, 4]);
  });

  it('detecta correctamente modo Router de fixture real Huawei HG8546M', () => {
    const res = detectOnuMode(routerFixture);
    expect(res.mode).toBe('router');
    expect(res.confidence).toBe('high');
    expect(res.internetVlan).toBe(400);
    expect(res.managementVlan).toBe(46);
    expect(res.internetIpHost).toBe(1);
    expect(res.managementIpHost).toBe(2);
    expect(res.dhcpSource).toBe('from-onu');
    expect(res.ethPortsDetected).toEqual([1, 2, 3, 4]);
  });

  it('clasifica como mixed cuando hay elementos residuales de ambos modos', () => {
    const mixed = `
pon-onu-mng gpon-onu_1/2/15:1
  switchport-bind switch_0/1 iphost 1
  vlan-filter iphost 1 pri 0 vlan 400
  vlan port eth_0/1 mode tag vlan 400
!
`;
    const res = detectOnuMode(mixed);
    expect(res.mode).toBe('mixed');
    expect(res.confidence).toBe('low');
  });

  it('devuelve unknown ante configuración vacía o insuficiente', () => {
    expect(detectOnuMode('')).toEqual(
      expect.objectContaining({ mode: 'unknown', confidence: 'low' }),
    );
    expect(detectOnuMode('pon-onu-mng gpon-onu_1/1/1:1\n!')).toEqual(
      expect.objectContaining({ mode: 'unknown', confidence: 'low' }),
    );
  });

  it('extrae dinámicamente VLANs distintas (Internet 200, Gestión 100)', () => {
    const custom = `
pon-onu-mng gpon-onu_1/2/1:1
  flow 1 pri 0 vlan 200
  flow 2 pri 2 vlan 100
  vlan port eth_0/1 mode tag vlan 200
  vlan-filter iphost 2 pri 2 vlan 100
!
`;
    const res = detectOnuMode(custom);
    expect(res.mode).toBe('bridge');
    expect(res.internetVlan).toBe(200);
    expect(res.managementVlan).toBe(100);
    expect(res.ethPortsDetected).toEqual([1]);
  });

  it('detecta adecuadamente modelos de 1 solo puerto LAN', () => {
    const singlePortBridge = `
pon-onu-mng gpon-onu_1/2/1:1
  vlan port eth_0/1 mode tag vlan 500
!
`;
    const res = detectOnuMode(singlePortBridge);
    expect(res.mode).toBe('bridge');
    expect(res.ethPortsDetected).toEqual([1]);
    expect(res.internetVlan).toBe(500);
  });

  it('soporta variaciones de formato con CRLF y espacios extras', () => {
    const crlf = bridgeFixture.replace(/\n/g, '\r\n');
    const res = detectOnuMode(crlf);
    expect(res.mode).toBe('bridge');
    expect(res.confidence).toBe('high');
  });

  it('marca dhcpSource como "none" si no hay líneas dhcp-ip ethuni', () => {
    const noDhcp = `
pon-onu-mng gpon-onu_1/2/1:1
  vlan port eth_0/1 mode tag vlan 400
!
`;
    const res = detectOnuMode(noDhcp);
    expect(res.dhcpSource).toBe('none');
  });
});
