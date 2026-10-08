import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OltMonitoringService } from './olt-monitoring.service';
import { OltEntity } from '../entities/olt.entity';
import { OltMetricEntity } from '../entities/olt-metric.entity';
import { OnuEntity } from '../entities/onu.entity';
import { CompanyProfileEntity } from '../../company/entities/company-profile.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { encryptCredential } from '../../network-connectivity/utils/crypto.util';
import { NO_DRIVER_CAPABILITIES } from '../ports/olt-driver.port';

describe('OltMonitoringService', () => {
  let service: OltMonitoringService;

  const mockOltRepo = {
    findOne: jest.fn(),
  };

  const mockMetricRepo = {
    create: jest.fn().mockImplementation((dto) => ({ id: 'metric-1', ...dto, createdAt: new Date() })),
    save: jest.fn().mockImplementation((m) => Promise.resolve(m)),
    find: jest.fn(),
    delete: jest.fn(),
  };

  const mockOnuRepo = {
    count: jest.fn(),
  };

  const mockCompanyRepo = {
    findOne: jest.fn(),
  };

  const mockNodeRepo = {
    findOneBy: jest.fn(),
  };

  const mockReachability = {
    resolveEndpoint: jest.fn(),
  };

  const mockDriverRegistry = {
    resolve: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OltMonitoringService,
        { provide: getRepositoryToken(OltEntity), useValue: mockOltRepo },
        { provide: getRepositoryToken(OltMetricEntity), useValue: mockMetricRepo },
        { provide: getRepositoryToken(OnuEntity), useValue: mockOnuRepo },
        { provide: getRepositoryToken(CompanyProfileEntity), useValue: mockCompanyRepo },
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: mockNodeRepo },
        { provide: ReachabilityResolver, useValue: mockReachability },
        { provide: OltDriverRegistry, useValue: mockDriverRegistry },
      ],
    }).compile();

    service = module.get<OltMonitoringService>(OltMonitoringService);
  });

  const baseOlt = {
    id: 'olt-1',
    name: 'OLT-Azua',
    vendor: 'HIOSO',
    model: 'EPON',
    host: '172.16.100.5',
    port: 2324,
    connectionMethod: 'DIRECT',
    username: 'admin',
    passwordEnc: encryptCredential('admin'),
    interfaces: [
      { type: 'PON' }, { type: 'PON' }, { type: 'PON' }, { type: 'PON' }, { type: 'UPLINK' },
    ],
  };

  it('usa el driver real del fabricante: nunca inventa CPU/memoria/temperatura si la capacidad no es real', async () => {
    mockOltRepo.findOne.mockResolvedValue({ ...baseOlt });
    mockOnuRepo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    mockCompanyRepo.findOne.mockResolvedValue({ telegramAlertsEnabled: false });

    const fakeDriver = {
      getCapabilities: () => ({ ...NO_DRIVER_CAPABILITIES }),
      getSystemHealth: jest.fn(),
      getCards: jest.fn(),
    };
    mockDriverRegistry.resolve.mockReturnValue(fakeDriver);

    const metric = await service.collectAndRecordMetrics('olt-1');

    expect(fakeDriver.getSystemHealth).not.toHaveBeenCalled();
    expect(fakeDriver.getCards).not.toHaveBeenCalled();
    expect(metric.cpuUsagePercent).toBeUndefined();
    expect(metric.memoryUsagePercent).toBeUndefined();
    expect(metric.temperatureCelsius).toBeUndefined();
    expect(metric.cardsInfo).toEqual([]);
    expect(metric.alarmsInfo).toEqual([]);
    expect(metric.rawTelemetry.ponInterfacesCount).toBe(4);
    expect(mockMetricRepo.save).toHaveBeenCalled();
    expect(mockMetricRepo.delete).toHaveBeenCalled();
  });

  it('usa los valores reales devueltos por el driver cuando systemHealth/chassisCards sí están implementados', async () => {
    mockOltRepo.findOne.mockResolvedValue({ ...baseOlt, vendor: 'ZTE' });
    mockOnuRepo.count.mockResolvedValueOnce(45).mockResolvedValueOnce(3);
    mockCompanyRepo.findOne.mockResolvedValue({ telegramAlertsEnabled: false });

    const fakeDriver = {
      getCapabilities: () => ({ ...NO_DRIVER_CAPABILITIES, systemHealth: true, chassisCards: true }),
      getSystemHealth: jest.fn().mockResolvedValue({
        cpuUsagePercent: 22,
        memoryUsagePercent: 51,
        temperatureCelsius: 41.5,
        uptimeSeconds: 123456,
      }),
      getCards: jest.fn().mockResolvedValue([
        { slot: 1, cardType: 'GTGH', realType: 'GTGH', portCount: 16, hardVer: 'V1.2.0', softVer: 'V2.1.0', status: 'INSERVICE' },
      ]),
    };
    mockDriverRegistry.resolve.mockReturnValue(fakeDriver);

    const metric = await service.collectAndRecordMetrics('olt-1');

    expect(metric.cpuUsagePercent).toBe(22);
    expect(metric.memoryUsagePercent).toBe(51);
    expect(metric.temperatureCelsius).toBe(41.5);
    expect(metric.uptimeSeconds).toBe(123456);
    expect(metric.cardsInfo).toHaveLength(1);
    expect(metric.cardsInfo[0].cardType).toBe('GTGH');
    expect(metric.activeOnusCount).toBe(45);
  });

  it('si el driver lanza al consultar salud, guarda el snapshot igual con los campos en undefined (nunca inventa)', async () => {
    mockOltRepo.findOne.mockResolvedValue({ ...baseOlt });
    mockOnuRepo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    mockCompanyRepo.findOne.mockResolvedValue({ telegramAlertsEnabled: false });

    const fakeDriver = {
      getCapabilities: () => ({ ...NO_DRIVER_CAPABILITIES, systemHealth: true }),
      getSystemHealth: jest.fn().mockRejectedValue(new Error('Timeout Telnet')),
      getCards: jest.fn(),
    };
    mockDriverRegistry.resolve.mockReturnValue(fakeDriver);

    const metric = await service.collectAndRecordMetrics('olt-1');

    expect(metric.cpuUsagePercent).toBeUndefined();
    expect(mockMetricRepo.save).toHaveBeenCalled();
  });

  it('getLatestMetrics() no dispara un poll nuevo si ya existe un snapshot reciente', async () => {
    mockMetricRepo.find.mockResolvedValue([{ id: 'm-1', oltId: 'olt-1', cpuUsagePercent: 20 }]);

    const result = await service.getLatestMetrics('olt-1');

    expect(result.id).toBe('m-1');
    expect(mockOltRepo.findOne).not.toHaveBeenCalled();
  });

  it('getLatestMetrics() genera un primer snapshot real si no existe ninguno todavía', async () => {
    mockMetricRepo.find.mockResolvedValue([]);
    mockOltRepo.findOne.mockResolvedValue({ ...baseOlt });
    mockOnuRepo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    mockCompanyRepo.findOne.mockResolvedValue({ telegramAlertsEnabled: false });
    mockDriverRegistry.resolve.mockReturnValue({
      getCapabilities: () => ({ ...NO_DRIVER_CAPABILITIES }),
      getSystemHealth: jest.fn(),
      getCards: jest.fn(),
    });

    const result = await service.getLatestMetrics('olt-1');

    expect(result).toBeDefined();
    expect(mockOltRepo.findOne).toHaveBeenCalled();
  });

  it('debe retornar histórico de métricas para las gráficas', async () => {
    mockMetricRepo.find.mockResolvedValue([
      { id: 'm-1', oltId: 'olt-1', cpuUsagePercent: 20, temperatureCelsius: 40 },
      { id: 'm-2', oltId: 'olt-1', cpuUsagePercent: 25, temperatureCelsius: 41 },
    ]);

    const history = await service.getMetricsHistory('olt-1', 24);
    expect(history).toHaveLength(2);
    expect(mockMetricRepo.find).toHaveBeenCalled();
  });
});
