/** Synthetic fixtures: protocol/state tests, not evidence of hardware compatibility. */
export const tr069Input = {
  ponInterface: 'gpon-olt_1/2/15', onuId: 1, serialNumber: 'TEST00000001', modelTypeName: 'TEST-ONU',
  serviceVlan: 400, tr069Vlan: 50, tr069Url: 'http://acs.example.test:7547/',
  managementMethod: 'TR069' as const, operationMode: 'ROUTER' as const,
};
export function tr069Snapshot(vlan?: number, acs = tr069Input.tr069Url): string {
  return [
    'interface gpon-olt_1/2/15', 'onu 1 type TEST-ONU sn TEST00000001', '!',
    'interface gpon-onu_1/2/15:1', 'tcont 1 profile INTERNET', 'gemport 1 tcont 1',
    'service-port 1 vport 1 user-vlan 400 vlan 400',
    ...(vlan ? ['tcont 2 profile SMARTOLT-VOIPMNG-10M', 'gemport 2 tcont 2', `service-port 2 vport 2 user-vlan ${vlan} vlan ${vlan}`] : []), '!',
    ...(vlan ? ['pon-onu-mng gpon-onu_1/2/15:1', 'flow 2 switch switch_0/1',
      'flow mode 2 tag-filter vlan-filter untag-filter discard', `flow 2 pri 2 vlan ${vlan}`, 'gemport 2 flow 2',
      'switchport-bind switch_0/1 iphost 2', 'switchport-bind switch_0/1 veip 1', 'ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable',
      'vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard', `vlan-filter iphost 2 pri 2 vlan ${vlan}`,
      'veip 1 port udp 1232 host 2',
      'tr069-mgmt 1 state unlock', `tr069-mgmt 1 acs ${acs}`, `tr069-mgmt 1 tag pri 2 vlan ${vlan}`,
      'security-mgmt 998 state enable mode forward ingress-type lan protocol web https',
      'security-mgmt 999 state enable ingress-type lan protocol tr069', '!'] : []), 'end',
  ].join('\n');
}
export function tr069Session(options: { before?: string; after?: string; reject?: string; failIo?: string; detail?: string; host?: string } = {}) {
  let reads = 0;
  const session = {
    connectAndLogin: jest.fn().mockResolvedValue(undefined), close: jest.fn().mockResolvedValue(undefined), rebootOnu: jest.fn(),
    executeCommand: jest.fn().mockImplementation(async (cmd: string) => {
      if (cmd === options.failIo) throw new Error('Timeout con secreto PRIVATE-ACS');
      if (cmd === options.reject) return '%Error 20200: Invalid input detected';
      if (cmd === 'show running-config') return ++reads === 1 ? options.before ?? tr069Snapshot() : options.after ?? tr069Snapshot(50);
      if (cmd === 'show gpon profile tcont') return 'Profile name :SMARTOLT-VOIPMNG-10M\n5 512 1024 11264 N/A N/A';
      if (cmd === 'show vlan') return 'VLAN Name\n46 mgmt-old\n50 mgmt-new';
      if (cmd.startsWith('show gpon onu detail-info')) return options.detail ?? 'Config state: success\nPhase state: working';
      if (cmd.startsWith('show gpon remote-onu ip-host')) return options.host ?? 'Host ID: 2\nIP address: 10.50.0.2';
      return '';
    }),
  };
  return session;
}
