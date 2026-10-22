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
    objectInstanceExists: jest.fn(),
    addObject: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Por defecto, el objeto WAN ya existe en el CPE (caso mas comun en los
    // tests existentes, que no se enfocan en el flujo de creacion) -- los
    // tests nuevos de AddObject sobreescriben esto explicitamente.
    // `clearAllMocks()` NO limpia implementaciones (mockResolvedValue/
    // mockRejectedValue) de un test anterior, solo mock.calls -- por eso se
    // fija un default explicito tambien para refreshObject (bug real
    // encontrado aqui mismo: un test que probaba el refreshObject fallido
    // contaminaba el siguiente test sin este default).
    mockClient.objectInstanceExists.mockResolvedValue(true);
    mockClient.refreshObject.mockResolvedValue(undefined);

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

  it('asigna también el tag OLT:<nombre> si se provee oltName', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue('00259E-ONT123');
    mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT123', isTR181: false, tags: [] });
    mockClient.setParameterValues.mockResolvedValue(undefined);
    mockClient.getParameterValues.mockResolvedValue({});

    const input: CpeConfigurationInput = {
      serialNumber: 'ONT123',
      wanMode: 'PPPOE',
      tenantSlug: 'isp-azua',
      oltName: 'OLT_Tabara_Abajo',
    };

    await service.configureCpe(input);

    expect(mockClient.setDeviceTag).toHaveBeenCalledWith('00259E-ONT123', 'TENANT:isp-azua');
    expect(mockClient.setDeviceTag).toHaveBeenCalledWith('00259E-ONT123', 'OLT:OLT_Tabara_Abajo');
  });

  it('es idempotente: no vuelve a llamar setDeviceTag si el dispositivo ya tiene los tags puestos (necesario para el reintento automático)', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue('00259E-ONT123');
    mockClient.getDeviceStatus.mockResolvedValue({
      deviceId: '00259E-ONT123',
      isTR181: false,
      tags: ['TENANT:isp-azua', 'OLT:OLT_Tabara_Abajo'],
    });
    mockClient.setParameterValues.mockResolvedValue(undefined);
    mockClient.getParameterValues.mockResolvedValue({});

    const input: CpeConfigurationInput = {
      serialNumber: 'ONT123',
      wanMode: 'PPPOE',
      tenantSlug: 'isp-azua',
      oltName: 'OLT_Tabara_Abajo',
    };

    await service.configureCpe(input);

    expect(mockClient.setDeviceTag).not.toHaveBeenCalled();
  });

  it('crea el objeto WANPPPConnection con AddObject si todavía no existe en el CPE (TR-098)', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue('00259E-ONT123');
    mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT123', isTR181: false, tags: [] });
    mockClient.objectInstanceExists
      .mockResolvedValueOnce(false) // antes de AddObject: no existe
      .mockResolvedValueOnce(true); // después de AddObject: ya existe
    mockClient.addObject.mockResolvedValue(undefined);
    mockClient.setParameterValues.mockResolvedValue(undefined);
    mockClient.getParameterValues.mockResolvedValue({});

    const input: CpeConfigurationInput = {
      serialNumber: 'ONT123',
      wanMode: 'PPPOE',
      pppoeUsername: 'cliente@sumtech',
      pppoePassword: 'pass',
    };

    const result = await service.configureCpe(input);

    expect(result.success).toBe(true);
    expect(mockClient.addObject).toHaveBeenCalledWith(
      '00259E-ONT123',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.',
    );
    expect(mockClient.objectInstanceExists).toHaveBeenNthCalledWith(
      1,
      '00259E-ONT123',
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1',
    );
    // setParameterValues debe correr DESPUÉS de AddObject, no antes.
    expect(mockClient.addObject.mock.invocationCallOrder[0]).toBeLessThan(
      mockClient.setParameterValues.mock.invocationCallOrder[0],
    );
  });

  it('NO llama a refreshObject en el flujo de configureCpe -- GenieACS rechaza rutas recursivas para este tipo de chequeo (ver nota en el servicio)', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue('00259E-ONT123');
    mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT123', isTR181: false, tags: [] });
    mockClient.objectInstanceExists.mockResolvedValue(true);
    mockClient.setParameterValues.mockResolvedValue(undefined);
    mockClient.getParameterValues.mockResolvedValue({});

    await service.configureCpe({ serialNumber: 'ONT123', wanMode: 'PPPOE' });

    expect(mockClient.refreshObject).not.toHaveBeenCalled();
  });

  it('NO llama a AddObject si el objeto WAN ya existe en el CPE', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue('00259E-ONT123');
    mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT123', isTR181: false, tags: [] });
    mockClient.objectInstanceExists.mockResolvedValue(true);
    mockClient.setParameterValues.mockResolvedValue(undefined);
    mockClient.getParameterValues.mockResolvedValue({});

    await service.configureCpe({ serialNumber: 'ONT123', wanMode: 'PPPOE' });

    expect(mockClient.addObject).not.toHaveBeenCalled();
  });

  it('lanza BadRequestException si el CPE no crea la instancia esperada tras AddObject', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue('00259E-ONT123');
    mockClient.getDeviceStatus.mockResolvedValue({ deviceId: '00259E-ONT123', isTR181: false, tags: [] });
    mockClient.objectInstanceExists.mockResolvedValue(false); // sigue sin existir incluso después de AddObject
    mockClient.addObject.mockResolvedValue(undefined);

    await expect(service.configureCpe({ serialNumber: 'ONT123', wanMode: 'PPPOE' })).rejects.toThrow(
      /no creó la instancia esperada/,
    );
    expect(mockClient.setParameterValues).not.toHaveBeenCalled();
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

  it('refreshCpe lanza NotFoundException (no 500 genérico) si el CPE (ej. MAC de un ONU EPON) nunca reportó a GenieACS', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue(null);

    await expect(service.refreshCpe('04:b0:e7:d3:09:a6')).rejects.toThrow(NotFoundException);
    expect(mockClient.findDeviceBySerial).toHaveBeenCalledWith('04:b0:e7:d3:09:a6');
    expect(mockClient.refreshObject).not.toHaveBeenCalled();
  });

  it('factoryResetCpe lanza NotFoundException si el CPE nunca reportó a GenieACS', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue(null);

    await expect(service.factoryResetCpe('04:b0:e7:d3:09:a6')).rejects.toThrow(NotFoundException);
    expect(mockClient.factoryReset).not.toHaveBeenCalled();
  });

  it('refreshCpe resuelve el serial/MAC al _id real de GenieACS antes de refrescar', async () => {
    mockClient.findDeviceBySerial.mockResolvedValue('00259E-ONT-04B0E7D309A6');
    mockClient.refreshObject.mockResolvedValue(undefined);

    const result = await service.refreshCpe('04:b0:e7:d3:09:a6');

    expect(result.deviceId).toBe('00259E-ONT-04B0E7D309A6');
    expect(mockClient.refreshObject).toHaveBeenCalledWith('00259E-ONT-04B0E7D309A6');
  });
});
