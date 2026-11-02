import { affectsWanProvisioning, summarizeAcsTasks } from './acs-wan-tasks.util';

describe('ACS pending task classification for TR-069 WAN', () => {
  it.each([
    { name: 'getParameterValues', parameterNames: ['Device.PPP.Interface.1.Username'] },
    { name: 'refreshObject', objectName: 'InternetGatewayDevice.WANDevice.' },
    { name: 'setParameterValues', parameterValues: [['Device.WiFi.SSID.1.SSID', 'Customer', 'xsd:string']] },
    { name: 'addObject', objectName: 'Device.WiFi.SSID.' },
  ])('allows a known independent task: %j', task => expect(affectsWanProvisioning(task)).toBe(false));

  it.each([
    { name: 'setParameterValues', parameterValues: [['Device.PPP.Interface.1.Enable', 'true', 'xsd:boolean']] },
    { name: 'setParameterValues', parameterValues: [['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username', 'account', 'xsd:string']] },
    { name: 'setParameterValues', parameterValues: [['Device.ManagementServer.URL', 'https://acs.example', 'xsd:string']] },
    { name: 'addObject', objectName: 'Device.PPP.Interface.' },
    { name: 'deleteObject', objectName: 'InternetGatewayDevice.WANDevice.1.' },
    { name: 'reboot' }, { name: 'factoryReset' }, { name: 'download' },
    { name: 'setParameterValues', parameterValues: [] },
    { name: 'setParameterValues', parameterValues: [null] },
    { name: 'unknown' }, {}, null,
  ])('keeps a potentially conflicting task blocked: %j', task => expect(affectsWanProvisioning(task)).toBe(true));

  it('returns diagnostic identifiers without credentials or parameter values', () => {
    const summary = summarizeAcsTasks([{ _id: 'task-1', name: 'setParameterValues', parameterValues: [['Device.PPP.Interface.1.Password', 'secret', 'xsd:string']] }]);
    expect(summary).toEqual([{ id: 'task-1', name: 'setParameterValues' }]);
    expect(JSON.stringify(summary)).not.toContain('secret');
  });
});
