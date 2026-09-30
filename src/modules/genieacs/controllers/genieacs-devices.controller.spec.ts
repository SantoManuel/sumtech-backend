import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { GenieAcsDevicesController } from './genieacs-devices.controller';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { CpeConfiguratorService } from '../services/cpe-configurator.service';

describe('GenieAcsDevicesController', () => {
  let controller: GenieAcsDevicesController;
  let mockClient: any;
  let mockCpeConfigurator: any;

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
          Tags: { BOOTSTRAPPED: true, ONLINE: true },
        },
      ]),
      rebootDevice: jest.fn().mockResolvedValue(undefined),
    };

    mockCpeConfigurator = {
      refreshCpe: jest.fn().mockResolvedValue({ success: true, deviceId: 'DEV-01' }),
      factoryResetCpe: jest.fn().mockResolvedValue({ success: true, deviceId: 'DEV-01' }),
      configureCpe: jest.fn().mockResolvedValue({ success: true, deviceId: 'DEV-01' }),
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
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: TenantContextService,
          useValue: {
            hasContext: jest.fn().mockReturnValue(false),
            getTenantId: jest.fn(),
            getSlug: jest.fn(),
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
});
