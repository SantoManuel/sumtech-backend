import { CpeParameterMapper, CpeConfigurationInput } from './cpe-parameter-mapper';

describe('CpeParameterMapper', () => {
  let mapper: CpeParameterMapper;

  beforeEach(() => {
    mapper = new CpeParameterMapper();
  });

  describe('TR-181 Model', () => {
    it('genera parámetros PPPoE y VLAN para TR-181 correctamente', () => {
      const input: CpeConfigurationInput = {
        serialNumber: 'ZTEG-12345678',
        vendor: 'ZTE',
        wanMode: 'PPPOE',
        pppoeUsername: 'cliente01@sumtech',
        pppoePassword: 'secretPassword123',
        serviceVlan: 100,
        ipProtocol: 'IPV4',
      };

      const params = mapper.buildParameterValues(input, true);
      const paramMap = new Map(params.map(([k, v]) => [k, v]));

      expect(paramMap.get('Device.PPP.Interface.1.Enable')).toBe('true');
      expect(paramMap.get('Device.PPP.Interface.1.Username')).toBe('cliente01@sumtech');
      expect(paramMap.get('Device.PPP.Interface.1.Password')).toBe('secretPassword123');
      expect(paramMap.get('Device.Ethernet.VLANTermination.1.VLANID')).toBe('100');
    });

    it('genera parámetros de ManagementServer para TR-181', () => {
      const input: CpeConfigurationInput = {
        serialNumber: 'ZTEG-8888',
        managementServer: {
          acsUrl: 'http://10.15.160.1:7547/',
          acsUsername: 'acsuser',
          acsPassword: 'acspassword',
          informIntervalSec: 600,
        },
      };

      const params = mapper.buildParameterValues(input, true);
      const paramMap = new Map(params.map(([k, v]) => [k, v]));

      expect(paramMap.get('Device.ManagementServer.URL')).toBe('http://10.15.160.1:7547/');
      expect(paramMap.get('Device.ManagementServer.Username')).toBe('acsuser');
      expect(paramMap.get('Device.ManagementServer.PeriodicInformInterval')).toBe('600');
    });

    it('devuelve parámetros de verificación correctos para TR-181 PPPoE', () => {
      const input: CpeConfigurationInput = {
        serialNumber: 'ZTEG-123',
        wanMode: 'PPPOE',
        managementServer: { acsUrl: 'http://acs.local' },
      };

      const verify = mapper.getVerificationParameters(input, true);
      expect(verify).toContain('Device.PPP.Interface.1.Enable');
      expect(verify).toContain('Device.PPP.Interface.1.Username');
      expect(verify).toContain('Device.ManagementServer.URL');
    });
  });

  describe('TR-098 Model', () => {
    it('genera parámetros PPPoE con VLAN específica para ZTE en TR-098', () => {
      const input: CpeConfigurationInput = {
        serialNumber: 'ZTEG-99999999',
        vendor: 'ZTE Corporation',
        wanMode: 'PPPOE',
        pppoeUsername: 'zteuser@sumtech',
        pppoePassword: 'ztepassword',
        serviceVlan: 200,
      };

      const params = mapper.buildParameterValues(input, false);
      const paramMap = new Map(params.map(([k, v]) => [k, v]));

      const base = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
      expect(paramMap.get(`${base}.Enable`)).toBe('true');
      expect(paramMap.get(`${base}.Username`)).toBe('zteuser@sumtech');
      expect(paramMap.get(`${base}.Password`)).toBe('ztepassword');
      expect(paramMap.get(`${base}.X_ZTE-COM_VLAN`)).toBe('200');
    });

    it('genera parámetros PPPoE con VLAN específica para HUAWEI en TR-098', () => {
      const input: CpeConfigurationInput = {
        serialNumber: 'HWTC-11223344',
        vendor: 'Huawei Technologies',
        wanMode: 'PPPOE',
        pppoeUsername: 'hwuser@sumtech',
        pppoePassword: 'hwpassword',
        serviceVlan: 300,
      };

      const params = mapper.buildParameterValues(input, false);
      const paramMap = new Map(params.map(([k, v]) => [k, v]));

      const base = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
      expect(paramMap.get(`${base}.X_HW_VLAN`)).toBe('300');
    });

    it('genera parámetros para IP estática en TR-098', () => {
      const input: CpeConfigurationInput = {
        serialNumber: 'GEN-STATIC-01',
        wanMode: 'STATIC',
        wanStaticIp: '192.168.10.50',
        wanStaticMask: '255.255.255.0',
        wanStaticGw: '192.168.10.1',
        serviceVlan: 50,
      };

      const params = mapper.buildParameterValues(input, false);
      const paramMap = new Map(params.map(([k, v]) => [k, v]));

      const base = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1';
      expect(paramMap.get(`${base}.AddressingType`)).toBe('Static');
      expect(paramMap.get(`${base}.ExternalIPAddress`)).toBe('192.168.10.50');
      expect(paramMap.get(`${base}.SubnetMask`)).toBe('255.255.255.0');
      expect(paramMap.get(`${base}.DefaultGateway`)).toBe('192.168.10.1');
    });
  });
});
