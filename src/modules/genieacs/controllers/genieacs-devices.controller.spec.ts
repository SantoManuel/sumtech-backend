import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { ServiceUnavailableException } from '@nestjs/common';
import { GenieAcsDevicesController } from './genieacs-devices.controller';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { CpeConfiguratorService } from '../services/cpe-configurator.service';
import { GenieAcsSnapshotService } from '../services/genieacs-snapshot.service';
import { GenieAcsActivityLogService } from '../services/genieacs-activity-log.service';
import { GenieAcsSectionWriteService } from '../services/genieacs-section-write.service';
import { GenieAcsPortForwardingService } from '../services/genieacs-port-forwarding.service';
import { GenieAcsDiagnosticsService } from '../services/genieacs-diagnostics.service';
import { GenieAcsVendorParameterService } from '../services/genieacs-vendor-parameter.service';
import { GenieAcsFirmwareService } from '../services/genieacs-firmware.service';

describe('GenieAcsDevicesController', () => {
  let controller: GenieAcsDevicesController;
  let mockClient: any;
  let mockCpeConfigurator: any;
  let mockSnapshotService: any;
  let mockActivityLogService: any;
  let mockSectionWriteService: any;
  let mockPortForwardingService: any;
  let mockDiagnosticsService: any;
  let mockVendorParameterService: any;
  let mockFirmwareService: any;

  beforeEach(async () => {
    mockClient = {
      getDevices: jest.fn().mockResolvedValue([
        {
          _id: '00259E-EchoLife-HG8245H5',
          _deviceId: {
            _SerialNumber: '48575443ABC12345',
            _Manufacturer: 'Huawei',
            _ProductClass: 'HG8245H5',
          },
          _lastInform: new Date().toISOString(),
          Device: {
            DeviceInfo: { SoftwareVersion: { _value: 'V5R019C00S105' } },
            IP: {
              Interface: {
                '1': {
                  IPv4Address: {
                    '1': { IPAddress: { _value: '10.15.160.45' } },
                  },
                },
              },
            },
          },
          _tags: ['BOOTSTRAPPED', 'ONLINE'],
        },
      ]),
      rebootDevice: jest.fn().mockResolvedValue(undefined),
    };

    mockCpeConfigurator = {
      refreshCpe: jest.fn().mockResolvedValue({ success: true, deviceId: 'DEV-01' }),
      factoryResetCpe: jest.fn().mockResolvedValue({ success: true, deviceId: 'DEV-01' }),
      configureCpe: jest.fn().mockResolvedValue({ success: true, deviceId: 'DEV-01' }),
    };

    mockSnapshotService = {
      getFullSnapshot: jest.fn().mockResolvedValue({
        deviceId: 'DEV-01',
        isTR181: true,
        general: { manufacturer: 'ZTE', tags: [] },
      }),
    };

    mockActivityLogService = {
      getActivityLog: jest.fn().mockResolvedValue([
        { id: 'task-1', type: 'TASK', name: 'reboot', outcome: 'OK' },
      ]),
    };

    mockSectionWriteService = {
      updatePppInterface: jest.fn().mockResolvedValue({ appliedFields: ['Device.PPP.Interface.1.Username'], skippedFields: [] }),
      updateLanDhcpServer: jest.fn().mockResolvedValue({ appliedFields: [], skippedFields: [] }),
      toggleLanPort: jest.fn().mockResolvedValue(undefined),
      updateWirelessLan: jest.fn().mockResolvedValue({ appliedFields: [], skippedFields: [] }),
    };

    mockPortForwardingService = {
      addPortMapping: jest.fn().mockResolvedValue({ index: 3 }),
      deletePortMapping: jest.fn().mockResolvedValue(undefined),
    };

    mockDiagnosticsService = {
      triggerDiagnostic: jest.fn().mockResolvedValue(undefined),
      getDiagnosticStatus: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
    };

    mockVendorParameterService = {
      getTogglesForDevice: jest.fn().mockResolvedValue([]),
      setToggle: jest.fn().mockResolvedValue(undefined),
    };

    mockFirmwareService = {
      pushFirmware: jest.fn().mockResolvedValue({ softwareVersionBefore: 'V1', targetVersion: 'V2' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GenieAcsDevicesController],
      providers: [
        {
          provide: GENIEACS_CLIENT,
          useValue: mockClient,
        },
        {
          provide: CpeConfiguratorService,
          useValue: mockCpeConfigurator,
        },
        {
          provide: GenieAcsSnapshotService,
          useValue: mockSnapshotService,
        },
        {
          provide: GenieAcsActivityLogService,
          useValue: mockActivityLogService,
        },
        {
          provide: GenieAcsSectionWriteService,
          useValue: mockSectionWriteService,
        },
        {
          provide: GenieAcsPortForwardingService,
          useValue: mockPortForwardingService,
        },
        {
          provide: GenieAcsDiagnosticsService,
          useValue: mockDiagnosticsService,
        },
        {
          provide: GenieAcsVendorParameterService,
          useValue: mockVendorParameterService,
        },
        {
          provide: GenieAcsFirmwareService,
          useValue: mockFirmwareService,
        },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: TenantContextService,
          useValue: {
            hasContext: jest.fn().mockReturnValue(true),
            getTenantId: jest.fn(),
            getSlug: jest.fn().mockReturnValue('sumtech'),
          },
        },
      ],
    }).compile();

    controller = module.get<GenieAcsDevicesController>(GenieAcsDevicesController);
  });

  it('debe listar dispositivos formateados', async () => {
    const devices = await controller.getDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].serialNumber).toBe('48575443ABC12345');
    expect(devices[0].manufacturer).toBe('Huawei');
    expect(devices[0].ip).toBe('10.15.160.45');
    expect(devices[0].isOnline).toBe(true);
    expect(devices[0].tags).toContain('BOOTSTRAPPED');
  });

  it('filtra la consulta a GenieACS por el tag TENANT:<slug> del tenant actual (aislamiento multi-tenant)', async () => {
    await controller.getDevices();
    expect(mockClient.getDevices).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ _tags: 'TENANT:sumtech' }),
      }),
    );
  });

  it('combina el filtro de tenant con la búsqueda por texto vía $and', async () => {
    await controller.getDevices('Huawei');
    expect(mockClient.getDevices).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          $and: [
            { _tags: 'TENANT:sumtech' },
            expect.objectContaining({ $or: expect.any(Array) }),
          ],
        }),
      }),
    );
  });

  it('debe solicitar refresco al configurador', async () => {
    const res = await controller.refreshDevice('DEV-01');
    expect(res.success).toBe(true);
    expect(mockCpeConfigurator.refreshCpe).toHaveBeenCalledWith('DEV-01');
  });

  it('debe solicitar factory reset al configurador', async () => {
    const res = await controller.factoryResetDevice('DEV-01');
    expect(res.success).toBe(true);
    expect(mockCpeConfigurator.factoryResetCpe).toHaveBeenCalledWith('DEV-01');
  });

  describe('getTr069Snapshot', () => {
    it('devuelve el snapshot normalizado del servicio', async () => {
      const snapshot = await controller.getTr069Snapshot('DEV-01');

      expect(mockSnapshotService.getFullSnapshot).toHaveBeenCalledWith('DEV-01');
      expect(snapshot).toEqual({
        deviceId: 'DEV-01',
        isTR181: true,
        general: { manufacturer: 'ZTE', tags: [] },
      });
    });

    it('propaga tal cual un ServiceUnavailableException del servicio (GenieACS no configurado)', async () => {
      mockSnapshotService.getFullSnapshot.mockRejectedValue(
        new ServiceUnavailableException('El servidor GenieACS no está configurado'),
      );

      await expect(controller.getTr069Snapshot('DEV-01')).rejects.toThrow(ServiceUnavailableException);
    });

    it('envuelve cualquier otro error en ServiceUnavailableException', async () => {
      mockSnapshotService.getFullSnapshot.mockRejectedValue(new Error('GenieACS no tiene ningún dispositivo'));

      await expect(controller.getTr069Snapshot('DEV-01')).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('getActivityLog', () => {
    it('devuelve el historial del servicio', async () => {
      const log = await controller.getActivityLog('DEV-01');

      expect(mockActivityLogService.getActivityLog).toHaveBeenCalledWith('DEV-01');
      expect(log).toEqual([{ id: 'task-1', type: 'TASK', name: 'reboot', outcome: 'OK' }]);
    });

    it('envuelve cualquier error en ServiceUnavailableException', async () => {
      mockActivityLogService.getActivityLog.mockRejectedValue(new Error('timeout'));

      await expect(controller.getActivityLog('DEV-01')).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('endpoints de escritura (Paso 3 del plan)', () => {
    it('updatePppInterface delega al servicio con el actor correcto', async () => {
      const res = await controller.updatePppInterface('DEV-01', { username: 'juan' } as any, 'user-1');

      expect(mockSectionWriteService.updatePppInterface).toHaveBeenCalledWith('DEV-01', { username: 'juan' }, 'user-1');
      expect(res).toEqual({ success: true, appliedFields: ['Device.PPP.Interface.1.Username'], skippedFields: [] });
    });

    it('updateLanDhcpServer delega al servicio', async () => {
      await controller.updateLanDhcpServer('DEV-01', { minAddress: '192.168.1.2' } as any, 'user-1');

      expect(mockSectionWriteService.updateLanDhcpServer).toHaveBeenCalledWith('DEV-01', { minAddress: '192.168.1.2' }, 'user-1');
    });

    it('toggleLanPort convierte el portIndex a número y delega', async () => {
      const res = await controller.toggleLanPort('DEV-01', 2, { enabled: false }, 'user-1');

      expect(mockSectionWriteService.toggleLanPort).toHaveBeenCalledWith('DEV-01', 2, false, 'user-1');
      expect(res).toEqual({ success: true });
    });

    it('updateWirelessLan delega con el ssidIndex dado', async () => {
      await controller.updateWirelessLan('DEV-01', 1, { channel: 6 } as any, 'user-1');

      expect(mockSectionWriteService.updateWirelessLan).toHaveBeenCalledWith('DEV-01', 1, { channel: 6 }, 'user-1');
    });

    it('addPortMapping delega y devuelve el índice creado', async () => {
      const dto = { protocol: 'TCP', externalPort: 8080, internalPort: 80, internalClient: '192.168.1.50' } as any;
      const res = await controller.addPortMapping('DEV-01', dto, 'user-1');

      expect(mockPortForwardingService.addPortMapping).toHaveBeenCalledWith('DEV-01', dto, 'user-1');
      expect(res).toEqual({ success: true, index: 3 });
    });

    it('deletePortMapping convierte el índice a número y delega', async () => {
      const res = await controller.deletePortMapping('DEV-01', 2, 'user-1');

      expect(mockPortForwardingService.deletePortMapping).toHaveBeenCalledWith('DEV-01', 2, 'user-1');
      expect(res).toEqual({ success: true });
    });
  });

  describe('endpoints de diagnósticos (Paso 5 del plan)', () => {
    it('triggerDiagnostic valida el tipo y delega', async () => {
      const dto = { host: '8.8.8.8' } as any;
      const res = await controller.triggerDiagnostic('DEV-01', 'PING', dto, 'user-1');

      expect(mockDiagnosticsService.triggerDiagnostic).toHaveBeenCalledWith('DEV-01', 'PING', dto, 'user-1');
      expect(res.success).toBe(true);
    });

    it('triggerDiagnostic rechaza un tipo inválido antes de llamar al servicio', async () => {
      await expect(controller.triggerDiagnostic('DEV-01', 'HACKEAR', {} as any, 'user-1')).rejects.toThrow(
        'Tipo de diagnóstico inválido "HACKEAR" -- debe ser uno de: PING, TRACEROUTE, DOWNLOAD, UPLOAD, SITE_SURVEY.',
      );
      expect(mockDiagnosticsService.triggerDiagnostic).not.toHaveBeenCalled();
    });

    it('getDiagnosticStatus delega con el tipo validado', async () => {
      const res = await controller.getDiagnosticStatus('DEV-01', 'SITE_SURVEY');

      expect(mockDiagnosticsService.getDiagnosticStatus).toHaveBeenCalledWith('DEV-01', 'SITE_SURVEY');
      expect(res).toEqual({ status: 'RUNNING' });
    });
  });

  describe('endpoints de Security/Miscellaneous (Paso 6 del plan)', () => {
    it('getVendorToggles normaliza categorías desconocidas a SECURITY', async () => {
      await controller.getVendorToggles('DEV-01', 'algo-raro');

      expect(mockVendorParameterService.getTogglesForDevice).toHaveBeenCalledWith('DEV-01', 'SECURITY');
    });

    it('getVendorToggles respeta MISCELLANEOUS', async () => {
      await controller.getVendorToggles('DEV-01', 'MISCELLANEOUS');

      expect(mockVendorParameterService.getTogglesForDevice).toHaveBeenCalledWith('DEV-01', 'MISCELLANEOUS');
    });

    it('setVendorToggle delega con el actor correcto', async () => {
      const res = await controller.setVendorToggle('DEV-01', 'wanFtpEnable', { value: true }, 'user-1');

      expect(mockVendorParameterService.setToggle).toHaveBeenCalledWith('DEV-01', 'wanFtpEnable', true, 'user-1');
      expect(res).toEqual({ success: true });
    });
  });

  describe('pushFirmware (Paso 8 del plan)', () => {
    it('delega con el confirmVersion y el actor, y devuelve las versiones antes/después', async () => {
      const res = await controller.pushFirmware('DEV-01', 'fw-1', { confirmVersion: 'V2' }, 'user-1');

      expect(mockFirmwareService.pushFirmware).toHaveBeenCalledWith('DEV-01', 'fw-1', 'V2', 'user-1');
      expect(res).toEqual(
        expect.objectContaining({ success: true, softwareVersionBefore: 'V1', targetVersion: 'V2' }),
      );
    });
  });
});
