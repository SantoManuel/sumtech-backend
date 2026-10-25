import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GenieAcsSectionWriteService } from './genieacs-section-write.service';

describe('GenieAcsSectionWriteService', () => {
  let mockClient: {
    getDeviceStatus: jest.Mock;
    objectInstanceExists: jest.Mock;
    getParameterValues: jest.Mock;
  };
  let mockWriteService: { applyParameterChanges: jest.Mock };

  beforeEach(() => {
    mockClient = {
      getDeviceStatus: jest.fn(),
      objectInstanceExists: jest.fn(),
      getParameterValues: jest.fn(),
    };
    mockWriteService = { applyParameterChanges: jest.fn().mockResolvedValue(undefined) };
  });

  const makeService = () => new GenieAcsSectionWriteService(mockClient as any, mockWriteService as any);

  it('lanza ServiceUnavailableException si GenieACS no está configurado', async () => {
    const service = new GenieAcsSectionWriteService(null, mockWriteService as any);

    await expect(service.updatePppInterface('DEV-01', {}, 'admin')).rejects.toThrow(ServiceUnavailableException);
  });

  describe('updatePppInterface', () => {
    it('rechaza con BadRequestException si el equipo no tiene instancia PPP (WAN no es PPPoE)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.objectInstanceExists.mockResolvedValue(false);

      await expect(makeService().updatePppInterface('DEV-01', { username: 'juan' }, 'admin')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockWriteService.applyParameterChanges).not.toHaveBeenCalled();
    });

    it('TR-098: aplica username/password/serviceName/dns juntos', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: false });
      mockClient.objectInstanceExists.mockResolvedValue(true);

      const result = await makeService().updatePppInterface(
        '00259E-ONT-16',
        { username: 'juan', password: 'clave123', serviceName: 'INTERNET', dns1: '8.8.8.8', dns2: '1.1.1.1' },
        'admin@sumtech.com',
      );

      const base = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
      expect(mockWriteService.applyParameterChanges).toHaveBeenCalledWith(
        '00259E-ONT-16',
        expect.arrayContaining([
          { path: `${base}.Username`, value: 'juan', type: 'xsd:string' },
          { path: `${base}.Password`, value: 'clave123', type: 'xsd:string' },
          { path: `${base}.ServiceName`, value: 'INTERNET', type: 'xsd:string' },
          { path: `${base}.DNSServers`, value: '8.8.8.8,1.1.1.1', type: 'xsd:string' },
        ]),
        { actor: 'admin@sumtech.com', action: 'TR069_PARAMETER_CHANGE' },
      );
      expect(result.skippedFields).toEqual([]);
    });

    it('TR-181: ignora serviceName/connectionTrigger/dns (no estandarizados) y los reporta en skippedFields', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.objectInstanceExists.mockResolvedValue(true);

      const result = await makeService().updatePppInterface(
        'DEV-01',
        { username: 'juan', serviceName: 'INTERNET', connectionTrigger: 'AlwaysOn', dns1: '8.8.8.8' },
        'admin',
      );

      expect(mockWriteService.applyParameterChanges).toHaveBeenCalledWith(
        'DEV-01',
        [{ path: 'Device.PPP.Interface.1.Username', value: 'juan', type: 'xsd:string' }],
        { actor: 'admin', action: 'TR069_PARAMETER_CHANGE' },
      );
      expect(result.skippedFields).toEqual(['serviceName', 'connectionTrigger', 'dns1']);
    });
  });

  describe('updateLanDhcpServer', () => {
    it('TR-181: aplica el rango y separa dns1/dns2 en un único DNSServers', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });

      await makeService().updateLanDhcpServer(
        'DEV-01',
        { minAddress: '192.168.1.2', maxAddress: '192.168.1.254', dns1: '8.8.8.8', dns2: '8.8.4.4' },
        'admin',
      );

      expect(mockWriteService.applyParameterChanges).toHaveBeenCalledWith(
        'DEV-01',
        expect.arrayContaining([
          { path: 'Device.DHCPv4.Server.Pool.1.MinAddress', value: '192.168.1.2', type: 'xsd:string' },
          { path: 'Device.DHCPv4.Server.Pool.1.MaxAddress', value: '192.168.1.254', type: 'xsd:string' },
          { path: 'Device.DHCPv4.Server.Pool.1.DNSServers', value: '8.8.8.8,8.8.4.4', type: 'xsd:string' },
        ]),
        { actor: 'admin', action: 'TR069_PARAMETER_CHANGE' },
      );
    });
  });

  describe('toggleLanPort', () => {
    it('rechaza con BadRequestException si el índice de puerto no existe en el equipo', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockResolvedValue({ 'Device.Ethernet.InterfaceNumberOfEntries': '2' });

      await expect(makeService().toggleLanPort('DEV-01', 5, false, 'admin')).rejects.toThrow(BadRequestException);
      expect(mockWriteService.applyParameterChanges).not.toHaveBeenCalled();
    });

    it('con un índice válido, deshabilita el puerto', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: false });
      mockClient.getParameterValues.mockResolvedValue({
        'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfigNumberOfEntries': '4',
      });

      await makeService().toggleLanPort('00259E-ONT-16', 2, false, 'admin');

      expect(mockWriteService.applyParameterChanges).toHaveBeenCalledWith(
        '00259E-ONT-16',
        [{ path: 'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.2.Enable', value: 'false', type: 'xsd:boolean' }],
        { actor: 'admin', action: 'LAN_PORT_TOGGLE' },
      );
    });
  });

  describe('updateWirelessLan', () => {
    it('rechaza con BadRequestException si el índice de SSID no existe', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: false });
      mockClient.getParameterValues.mockResolvedValue({
        'InternetGatewayDevice.LANDevice.1.WLANConfigurationNumberOfEntries': '1',
      });

      await expect(makeService().updateWirelessLan('DEV-01', 2, { channel: 6 }, 'admin')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('aplica canal y auto-channel sobre el SSID indicado', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockResolvedValue({ 'Device.WiFi.SSIDNumberOfEntries': '2' });

      await makeService().updateWirelessLan('DEV-01', 2, { channel: 6, autoChannelEnabled: false }, 'admin');

      expect(mockWriteService.applyParameterChanges).toHaveBeenCalledWith(
        'DEV-01',
        [
          { path: 'Device.WiFi.Radio.2.Channel', value: '6', type: 'xsd:unsignedInt' },
          { path: 'Device.WiFi.Radio.2.AutoChannelEnable', value: 'false', type: 'xsd:boolean' },
        ],
        { actor: 'admin', action: 'TR069_PARAMETER_CHANGE' },
      );
    });
  });
});
