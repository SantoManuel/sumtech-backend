import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GenieAcsPortForwardingService } from './genieacs-port-forwarding.service';

function pickFromMaster(master: Record<string, string | undefined>) {
  return (_deviceId: string, paths: string[]) => {
    const result: Record<string, string | undefined> = {};
    for (const p of paths) result[p] = master[p];
    return Promise.resolve(result);
  };
}

describe('GenieAcsPortForwardingService', () => {
  let mockClient: {
    getDeviceStatus: jest.Mock;
    objectInstanceExists: jest.Mock;
    getParameterValues: jest.Mock;
    addObject: jest.Mock;
    deleteObject: jest.Mock;
  };
  let mockWriteService: { applyParameterChanges: jest.Mock; auditAction: jest.Mock };

  beforeEach(() => {
    mockClient = {
      getDeviceStatus: jest.fn(),
      objectInstanceExists: jest.fn(),
      getParameterValues: jest.fn(),
      addObject: jest.fn(),
      deleteObject: jest.fn(),
    };
    mockWriteService = {
      applyParameterChanges: jest.fn().mockResolvedValue(undefined),
      auditAction: jest.fn().mockResolvedValue(undefined),
    };
  });

  const makeService = () => new GenieAcsPortForwardingService(mockClient as any, mockWriteService as any);

  it('lanza ServiceUnavailableException si GenieACS no está configurado', async () => {
    const service = new GenieAcsPortForwardingService(null, mockWriteService as any);

    await expect(service.getPortMappings('DEV-01')).rejects.toThrow(ServiceUnavailableException);
  });

  describe('getPortMappings', () => {
    it('TR-181 lee de Device.NAT.PortMapping directamente', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          'Device.NAT.PortMappingNumberOfEntries': '1',
          'Device.NAT.PortMapping.1.Enable': 'true',
          'Device.NAT.PortMapping.1.Protocol': 'TCP',
          'Device.NAT.PortMapping.1.ExternalPort': '8080',
          'Device.NAT.PortMapping.1.InternalPort': '80',
          'Device.NAT.PortMapping.1.InternalClient': '192.168.1.50',
        }),
      );

      const mappings = await makeService().getPortMappings('DEV-01');

      expect(mappings).toEqual([
        {
          index: 1,
          enabled: true,
          protocol: 'TCP',
          externalPort: 8080,
          externalPortEndRange: undefined,
          internalPort: 80,
          internalClient: '192.168.1.50',
          description: undefined,
          leaseDuration: undefined,
        },
      ]);
    });

    it('TR-098: usa la tabla de WANPPPConnection si existe (modo PPPoE)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: false });
      mockClient.objectInstanceExists.mockImplementation((_id: string, path: string) =>
        Promise.resolve(path === 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1'),
      );
      const base = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.PortMapping';
      mockClient.getParameterValues.mockImplementation(
        pickFromMaster({
          [`${base}NumberOfEntries`]: '1',
          [`${base}.1.PortMappingEnabled`]: 'true',
          [`${base}.1.PortMappingProtocol`]: 'UDP',
          [`${base}.1.ExternalPort`]: '5000',
          [`${base}.1.InternalPort`]: '5000',
          [`${base}.1.InternalClient`]: '192.168.1.60',
        }),
      );

      const mappings = await makeService().getPortMappings('00259E-ONT-16');

      expect(mappings[0]).toMatchObject({ protocol: 'UDP', externalPort: 5000, internalClient: '192.168.1.60' });
    });

    it('TR-098: si ninguna conexión WAN existe todavía, devuelve arreglo vacío (no falla)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: false });
      mockClient.objectInstanceExists.mockResolvedValue(false);

      const mappings = await makeService().getPortMappings('00259E-ONT-16');

      expect(mappings).toEqual([]);
    });
  });

  describe('addPortMapping', () => {
    it('rechaza con BadRequestException si el equipo no tiene ninguna conexión WAN', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: false });
      mockClient.objectInstanceExists.mockResolvedValue(false);

      await expect(
        makeService().addPortMapping(
          '00259E-ONT-16',
          { protocol: 'TCP', externalPort: 8080, internalPort: 80, internalClient: '192.168.1.50' },
          'admin',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockClient.addObject).not.toHaveBeenCalled();
    });

    it('crea la instancia en el índice NumberOfEntries+1 y le aplica los campos', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockResolvedValue({ 'Device.NAT.PortMappingNumberOfEntries': '2' });
      mockClient.addObject.mockResolvedValue(undefined);

      const result = await makeService().addPortMapping(
        'DEV-01',
        { protocol: 'TCP', externalPort: 8080, internalPort: 80, internalClient: '192.168.1.50', description: 'Cámara' },
        'admin',
      );

      expect(result).toEqual({ index: 3 });
      expect(mockClient.addObject).toHaveBeenCalledWith('DEV-01', 'Device.NAT.PortMapping.');
      expect(mockWriteService.applyParameterChanges).toHaveBeenCalledWith(
        'DEV-01',
        expect.arrayContaining([
          { path: 'Device.NAT.PortMapping.3.Protocol', value: 'TCP', type: 'xsd:string' },
          { path: 'Device.NAT.PortMapping.3.ExternalPort', value: '8080', type: 'xsd:unsignedInt' },
          { path: 'Device.NAT.PortMapping.3.InternalClient', value: '192.168.1.50', type: 'xsd:string' },
          { path: 'Device.NAT.PortMapping.3.Description', value: 'Cámara', type: 'xsd:string' },
        ]),
        { actor: 'admin', action: 'PORT_FORWARD_ADD' },
      );
    });
  });

  describe('deletePortMapping', () => {
    it('elimina la instancia y audita con result OK', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.deleteObject.mockResolvedValue(undefined);

      await makeService().deletePortMapping('DEV-01', 2, 'admin');

      expect(mockClient.deleteObject).toHaveBeenCalledWith('DEV-01', 'Device.NAT.PortMapping.2');
      expect(mockWriteService.auditAction).toHaveBeenCalledWith(
        'DEV-01',
        { actor: 'admin', action: 'PORT_FORWARD_DELETE' },
        { parameterPath: 'Device.NAT.PortMapping.2', oldValue: 'existía', newValue: 'eliminada' },
        'OK',
      );
    });

    it('si el equipo rechaza la eliminación, audita con result ERROR y re-lanza', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.deleteObject.mockRejectedValue(new Error('No se pudo eliminar el objeto'));

      await expect(makeService().deletePortMapping('DEV-01', 2, 'admin')).rejects.toThrow('No se pudo eliminar el objeto');

      expect(mockWriteService.auditAction).toHaveBeenCalledWith(
        'DEV-01',
        { actor: 'admin', action: 'PORT_FORWARD_DELETE' },
        { parameterPath: 'Device.NAT.PortMapping.2' },
        'ERROR',
        'No se pudo eliminar el objeto',
      );
    });
  });
});
