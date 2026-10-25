import { ServiceUnavailableException } from '@nestjs/common';
import { GenieAcsSnapshotService } from './genieacs-snapshot.service';

/** Simula `getParameterValues`: solo responde con las claves que el master conoce, igual que la NBI real (ruta inexistente -> undefined, nunca error). */
function pickFromMaster(master: Record<string, string | undefined>) {
  return (_deviceId: string, paths: string[]) => {
    const result: Record<string, string | undefined> = {};
    for (const p of paths) result[p] = master[p];
    return Promise.resolve(result);
  };
}

describe('GenieAcsSnapshotService', () => {
  let mockClient: { getDeviceStatus: jest.Mock; getParameterValues: jest.Mock; objectInstanceExists: jest.Mock };
  let mockPortForwardingService: { getPortMappings: jest.Mock };

  beforeEach(() => {
    mockClient = {
      getDeviceStatus: jest.fn(),
      getParameterValues: jest.fn(),
      // Por defecto, sin instancia PPP -- los tests de PPP la sobrescriben a `true`.
      objectInstanceExists: jest.fn().mockResolvedValue(false),
    };
    mockPortForwardingService = { getPortMappings: jest.fn().mockResolvedValue([]) };
  });

  it('lanza ServiceUnavailableException si GenieACS no está configurado (cliente null)', async () => {
    const service = new GenieAcsSnapshotService(null, mockPortForwardingService as any);

    await expect(service.getFullSnapshot('00259E-ONT-16')).rejects.toThrow(ServiceUnavailableException);
  });

  describe('General (§3.1)', () => {
    it('arma el snapshot General de un equipo TR-181 usando las rutas "Device.*"', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({
        deviceId: 'ZTE-ONT-20',
        isTR181: true,
        manufacturer: 'ZTE',
        serialNumber: 'ZTEGC0123456',
        lastInformAt: new Date('2026-10-25T10:00:00Z'),
        registeredAt: new Date('2026-01-01T00:00:00Z'),
        tags: ['TENANT:sumtech'],
      });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'Device.DeviceInfo.ProductClass': 'F660',
          'Device.DeviceInfo.ModelName': 'F660V8',
          'Device.DeviceInfo.HardwareVersion': 'V8.0',
          'Device.DeviceInfo.SoftwareVersion': 'V8.0.10P1',
          'Device.DeviceInfo.UpTime': '123456',
          'Device.ManagementServer.ConnectionRequestURL': 'http://10.0.0.5:7547/',
          'Device.DeviceInfo.ProcessStatus.CPUUsage': '12',
          'Device.DeviceInfo.MemoryStatus.Total': '131072',
          'Device.DeviceInfo.MemoryStatus.Free': '65536',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('ZTE-ONT-20');

      expect(snapshot.deviceId).toBe('ZTE-ONT-20');
      expect(snapshot.isTR181).toBe(true);
      expect(snapshot.general).toEqual({
        manufacturer: 'ZTE',
        serialNumber: 'ZTEGC0123456',
        productClass: 'F660',
        modelName: 'F660V8',
        hardwareVersion: 'V8.0',
        softwareVersion: 'V8.0.10P1',
        uptimeSeconds: 123456,
        connectionRequestUrl: 'http://10.0.0.5:7547/',
        cpuUsagePercent: 12,
        memoryTotalKb: 131072,
        memoryFreeKb: 65536,
        lastInformAt: new Date('2026-10-25T10:00:00Z'),
        registeredAt: new Date('2026-01-01T00:00:00Z'),
        tags: ['TENANT:sumtech'],
      });
    });

    it('en un equipo TR-098, usa rutas "InternetGatewayDevice.*" y deja CPU/RAM en undefined (no estandarizado, no se inventan extensiones de fabricante)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({
        deviceId: '00259E-ONT-16',
        isTR181: false,
        manufacturer: 'Huawei',
        serialNumber: '485754435D448091',
        tags: [],
      });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'InternetGatewayDevice.DeviceInfo.ProductClass': 'HG8245H5',
          'InternetGatewayDevice.DeviceInfo.ModelName': 'HG8245H5',
          'InternetGatewayDevice.DeviceInfo.SoftwareVersion': 'V5R019C00S105',
          'InternetGatewayDevice.DeviceInfo.UpTime': '87000',
          'InternetGatewayDevice.ManagementServer.ConnectionRequestURL': 'http://10.0.0.9:30005/',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('00259E-ONT-16');

      expect(snapshot.isTR181).toBe(false);
      expect(snapshot.general.modelName).toBe('HG8245H5');
      expect(snapshot.general.hardwareVersion).toBeUndefined();
      expect(snapshot.general.cpuUsagePercent).toBeUndefined();
      expect(snapshot.general.memoryTotalKb).toBeUndefined();
      expect(snapshot.general.uptimeSeconds).toBe(87000);
    });

    it('un UpTime no numérico degrada a undefined en vez de romper o devolver NaN', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'Device.DeviceInfo.UpTime': 'not-a-number',
          'Device.DeviceInfo.ProcessStatus.CPUUsage': '-5',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.general.uptimeSeconds).toBeUndefined();
      expect(snapshot.general.cpuUsagePercent).toBeUndefined();
    });

    it('propaga un error legible si GenieACS no tiene el dispositivo', async () => {
      mockClient.getDeviceStatus.mockRejectedValue(
        new Error('GenieACS no tiene ningún dispositivo con el id "inexistente".'),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);

      await expect(service.getFullSnapshot('inexistente')).rejects.toThrow(/no tiene ningún dispositivo/);
    });
  });

  describe('LAN Counters (§3.7)', () => {
    it('enumera 2 interfaces Ethernet TR-181 usando "...InterfaceNumberOfEntries"', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'Device.Ethernet.InterfaceNumberOfEntries': '2',
          'Device.Ethernet.Interface.1.Stats.BytesSent': '1000',
          'Device.Ethernet.Interface.1.Stats.BytesReceived': '2000',
          'Device.Ethernet.Interface.2.Stats.BytesSent': '3000',
          'Device.Ethernet.Interface.2.Stats.BytesReceived': '4000',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.lanCounters).toHaveLength(2);
      expect(snapshot.lanCounters[0]).toMatchObject({ interfaceIndex: 1, bytesSent: 1000, bytesReceived: 2000 });
      expect(snapshot.lanCounters[1]).toMatchObject({ interfaceIndex: 2, bytesSent: 3000, bytesReceived: 4000 });
    });

    it('sin "NumberOfEntries" (o en 0), devuelve un arreglo vacío en vez de fallar', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.getParameterValues.mockImplementation(pickFromMaster({}));

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.lanCounters).toEqual([]);
    });
  });

  describe('WLAN Counters (§3.9)', () => {
    it('TR-098 usa "TotalBytesSent/Received" bajo WLANConfiguration', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT-16', isTR181: false, tags: [] });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'InternetGatewayDevice.LANDevice.1.WLANConfigurationNumberOfEntries': '1',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalBytesSent': '500',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalBytesReceived': '700',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('00259E-ONT-16');

      expect(snapshot.wlanCounters).toEqual([
        { ssidIndex: 1, totalBytesSent: 500, totalBytesReceived: 700, totalPacketsSent: undefined, totalPacketsReceived: undefined },
      ]);
    });
  });

  describe('Hosts (§3.11)', () => {
    it('TR-181 lee "PhysAddress" y lo normaliza como macAddress', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'Device.Hosts.HostNumberOfEntries': '1',
          'Device.Hosts.Host.1.IPAddress': '192.168.1.50',
          'Device.Hosts.Host.1.PhysAddress': 'AA:BB:CC:DD:EE:FF',
          'Device.Hosts.Host.1.HostName': 'laptop-juan',
          'Device.Hosts.Host.1.Active': 'true',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.hosts).toEqual([
        {
          ipAddress: '192.168.1.50',
          macAddress: 'AA:BB:CC:DD:EE:FF',
          hostName: 'laptop-juan',
          interfaceType: undefined,
          active: true,
        },
      ]);
    });

    it('TR-098 lee "MACAddress" directamente', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT-16', isTR181: false, tags: [] });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries': '1',
          'InternetGatewayDevice.LANDevice.1.Hosts.Host.1.MACAddress': '11:22:33:44:55:66',
          'InternetGatewayDevice.LANDevice.1.Hosts.Host.1.Active': 'false',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('00259E-ONT-16');

      expect(snapshot.hosts[0].macAddress).toBe('11:22:33:44:55:66');
      expect(snapshot.hosts[0].active).toBe(false);
    });
  });

  describe('IP Interface (§3.4)', () => {
    it('TR-181 enumera todas las instancias reales de Device.IP.Interface', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'Device.IP.InterfaceNumberOfEntries': '2',
          'Device.IP.Interface.1.Name': 'wan',
          'Device.IP.Interface.1.IPv4Address.1.IPAddress': '10.0.0.5',
          'Device.IP.Interface.2.Name': 'tr069-mgmt',
          'Device.IP.Interface.2.IPv4Address.1.IPAddress': '10.46.0.2',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.ipInterfaces).toHaveLength(2);
      expect(snapshot.ipInterfaces[1]).toMatchObject({ index: 2, name: 'tr069-mgmt', ipAddress: '10.46.0.2' });
    });

    it('TR-098 solo lee la instancia .1 de WANIPConnection (limitación documentada)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT-16', isTR181: false, tags: [] });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress': '186.1.2.3',
          'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ConnectionStatus': 'Connected',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('00259E-ONT-16');

      expect(snapshot.ipInterfaces).toEqual([
        { index: 1, name: 'WAN (servicio)', ipAddress: '186.1.2.3', subnetMask: undefined, connectionStatus: 'Connected' },
      ]);
    });

    it('TR-098 sin WANIPConnection activa (ej. el equipo usa PPPoE, no IP estática/DHCP) devuelve arreglo vacío', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT-16', isTR181: false, tags: [] });
      mockClient.getParameterValues.mockImplementation(pickFromMaster({}));

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('00259E-ONT-16');

      expect(snapshot.ipInterfaces).toEqual([]);
    });
  });

  describe('PPP Interface (§3.2)', () => {
    it('supported=false y el resto undefined si el CPE no tiene la instancia PPP (ej. WAN en modo STATIC)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.objectInstanceExists.mockResolvedValue(false);
      mockClient.getParameterValues.mockImplementation(pickFromMaster({}));

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.pppInterface).toEqual({ supported: false });
    });

    it('TR-098 lee serviceName/connectionTrigger/DNS (conceptos que TR-181 no estandariza)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT-16', isTR181: false, tags: [] });
      mockClient.objectInstanceExists.mockResolvedValue(true);
      const base = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          [`${base}.ConnectionStatus`]: 'Connected',
          [`${base}.ExternalIPAddress`]: '186.1.2.3',
          [`${base}.Username`]: 'juan123',
          [`${base}.ServiceName`]: 'INTERNET',
          [`${base}.ConnectionTrigger`]: 'AlwaysOn',
          [`${base}.DNSServers`]: '8.8.8.8, 1.1.1.1',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('00259E-ONT-16');

      expect(snapshot.pppInterface).toEqual({
        supported: true,
        connectionStatus: 'Connected',
        externalIpAddress: '186.1.2.3',
        username: 'juan123',
        serviceName: 'INTERNET',
        lastConnectionError: undefined,
        maxMruSize: undefined,
        connectionTrigger: 'AlwaysOn',
        dns1: '8.8.8.8',
        dns2: '1.1.1.1',
      });
    });

    it('TR-181 deja serviceName/connectionTrigger/dns en undefined (no estandarizados), no en error', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.objectInstanceExists.mockResolvedValue(true);
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({ 'Device.PPP.Interface.1.Username': 'juan123' }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.pppInterface.username).toBe('juan123');
      expect(snapshot.pppInterface.serviceName).toBeUndefined();
      expect(snapshot.pppInterface.connectionTrigger).toBeUndefined();
      expect(snapshot.pppInterface.dns1).toBeUndefined();
    });
  });

  describe('LAN DHCP Server (§3.5)', () => {
    it('TR-098 lee LANHostConfigManagement y separa DNSServers en dns1/dns2', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT-16', isTR181: false, tags: [] });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DHCPServerEnable': 'true',
          'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.MinAddress': '192.168.1.2',
          'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.MaxAddress': '192.168.1.254',
          'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers': '8.8.8.8,8.8.4.4',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('00259E-ONT-16');

      expect(snapshot.lanDhcpServer).toEqual({
        enabled: true,
        minAddress: '192.168.1.2',
        maxAddress: '192.168.1.254',
        subnetMask: undefined,
        dns1: '8.8.8.8',
        dns2: '8.8.4.4',
        domainName: undefined,
        ipRouters: undefined,
      });
    });
  });

  describe('LAN Ports (§3.6)', () => {
    it('enumera los puertos físicos con su estado Enable/Status', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'Device.Ethernet.InterfaceNumberOfEntries': '1',
          'Device.Ethernet.Interface.1.Enable': 'true',
          'Device.Ethernet.Interface.1.Status': 'Up',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.lanPorts).toEqual([{ portIndex: 1, enabled: true, status: 'Up' }]);
    });
  });

  describe('Wireless LAN avanzado (§3.8)', () => {
    it('lee enable/ssid-advertisement/canal + dispositivos asociados por SSID', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT-16', isTR181: false, tags: [] });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'InternetGatewayDevice.LANDevice.1.WLANConfigurationNumberOfEntries': '1',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable': 'true',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSIDAdvertisementEnabled': 'true',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel': '6',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AutoChannelEnable': 'false',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations': '1',
          'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.1.AssociatedDeviceMACAddress':
            'AA:BB:CC:DD:EE:FF',
        }),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('00259E-ONT-16');

      expect(snapshot.wirelessLan).toHaveLength(1);
      expect(snapshot.wirelessLan[0]).toMatchObject({
        ssidIndex: 1,
        enabled: true,
        ssidAdvertisementEnabled: true,
        channel: 6,
        autoChannelEnabled: false,
      });
      expect(snapshot.wirelessLan[0].associatedDevices).toEqual([
        { macAddress: 'AA:BB:CC:DD:EE:FF', lastDataDownlinkRate: undefined, lastDataUplinkRate: undefined },
      ]);
    });

    it('sin radios reportadas, devuelve arreglo vacío', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.getParameterValues.mockImplementation(pickFromMaster({}));

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.wirelessLan).toEqual([]);
    });
  });

  describe('Voice lines (§3.13)', () => {
    it('voiceSupported=false cuando el equipo no tiene Services.VoiceService.1 (ningún ONU de este tenant vende VoIP hoy)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.getParameterValues.mockImplementation(pickFromMaster({}));
      mockClient.objectInstanceExists.mockResolvedValue(false);

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.voiceSupported).toBe(false);
    });

    it('voiceSupported=true cuando el equipo sí reporta la instancia VoiceService', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.getParameterValues.mockImplementation(pickFromMaster({}));
      mockClient.objectInstanceExists.mockImplementation((_id: string, path: string) =>
        Promise.resolve(path === 'Device.Services.VoiceService.1'),
      );

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(snapshot.voiceSupported).toBe(true);
    });
  });

  describe('Port Forwarding (§3.3)', () => {
    it('delega al GenieAcsPortForwardingService', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ deviceId: 'DEV-01', isTR181: true, tags: [] });
      mockClient.getParameterValues.mockImplementation(pickFromMaster({}));
      mockPortForwardingService.getPortMappings.mockResolvedValue([
        { index: 1, protocol: 'TCP', externalPort: 8080, internalPort: 80, internalClient: '192.168.1.50' },
      ]);

      const service = new GenieAcsSnapshotService(mockClient as any, mockPortForwardingService as any);
      const snapshot = await service.getFullSnapshot('DEV-01');

      expect(mockPortForwardingService.getPortMappings).toHaveBeenCalledWith('DEV-01');
      expect(snapshot.portForwarding).toEqual([
        { index: 1, protocol: 'TCP', externalPort: 8080, internalPort: 80, internalClient: '192.168.1.50' },
      ]);
    });
  });
});
