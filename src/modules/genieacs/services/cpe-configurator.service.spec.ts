import { Test, TestingModule } from '@nestjs/testing';
import { CpeConfiguratorService } from './cpe-configurator.service';
import { CpeParameterMapper, CpeConfigurationInput } from './cpe-parameter-mapper';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { NotFoundException } from '@nestjs/common';

describe('CpeConfiguratorService', () => {
  let service: CpeConfiguratorService;
  let parameterMapper: CpeParameterMapper;

  const mockClient = {
    findDeviceBySerial: jest.fn(),
    getDeviceStatus: jest.fn(),
    setParameterValues: jest.fn(),
    getParameterValues: jest.fn(),
    setDeviceTag: jest.fn(),
    refreshObject: jest.fn(),
    factoryReset: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CpeConfiguratorService,
        CpeParameterMapper,
        {
          provide: GENIEACS_CLIENT,
          useValue: mockClient,
        },
      ],
    }).compile();

    service = module.get<CpeConfiguratorService>(CpeConfiguratorService);
    parameterMapper = module.get<CpeParameterMapper>(CpeParameterMapper);
  });

  it('debe lanzar NotFoundException si el dispositivo no existe en GenieACS', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue(null);

    const input: CpeConfigurationInput = {
      serialNumber: 'UNKNOWN-SERIAL',
      wanMode: 'PPPOE',
    };

    await expect(service.configureCpe(input)).rejects.toThrow(NotFoundException);
  });

  it('debe empujar configuración TR-069, asignar tag TENANT y verificar parámetros', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue('00259E-ONT123');
    mockClient.getDeviceStatus.mockResolvedValue({
      deviceId: '00259E-ONT123',
      isTR181: false,
    });
    mockClient.setParameterValues.mockResolvedValue(undefined);
    mockClient.setDeviceTag.mockResolvedValue(undefined);
    mockClient.getParameterValues.mockResolvedValue({
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable': 'true',
    });

    const input: CpeConfigurationInput = {
      serialNumber: 'ONT123',
      vendor: 'ZTE',
      wanMode: 'PPPOE',
      pppoeUsername: 'cliente@sumtech',
      pppoePassword: 'pass',
      serviceVlan: 100,
      tenantSlug: 'isp-azua',
    };

    const result = await service.configureCpe(input);

    expect(result.success).toBe(true);
    expect(result.deviceId).toBe('00259E-ONT123');
    expect(mockClient.setParameterValues).toHaveBeenCalled();
    expect(mockClient.setDeviceTag).toHaveBeenCalledWith('00259E-ONT123', 'TENANT:isp-azua');
    expect(mockClient.getParameterValues).toHaveBeenCalled();
  });

  it('debe refrescar el dispositivo llamando a refreshObject', async () => {
    mockClient.refreshObject.mockResolvedValue(undefined);

    const result = await service.refreshCpe('DEVICE-ID-01');
    expect(result.success).toBe(true);
    expect(mockClient.refreshObject).toHaveBeenCalledWith('DEVICE-ID-01');
  });

  it('debe enviar factoryReset al CPE', async () => {
    mockClient.factoryReset.mockResolvedValue(undefined);

    const result = await service.factoryResetCpe('DEVICE-ID-01');
    expect(result.success).toBe(true);
    expect(mockClient.factoryReset).toHaveBeenCalledWith('DEVICE-ID-01');
  });
});
