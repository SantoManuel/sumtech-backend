import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OltMonitoringService } from './olt-monitoring.service';
import { OltEntity } from '../entities/olt.entity';
import { OltMetricEntity } from '../entities/olt-metric.entity';
import { OnuEntity } from '../entities/onu.entity';
import { CompanyProfileEntity } from '../../company/entities/company-profile.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';

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
    findOne: jest.fn(),
  };

  const mockReachability = {
    resolveEndpoint: jest.fn(),
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
      ],
    }).compile();

    service = module.get<OltMonitoringService>(OltMonitoringService);
  });

  it('debe recolectar métricas de la OLT y persistir el snapshot con 30 días de retención', async () => {
    mockOltRepo.findOne.mockResolvedValue({
      id: 'olt-1',
      name: 'OLT-Toros',
      vendor: 'ZTE',
      model: 'C320',
      interfaces: [{ id: 'if-1' }],
    });

    mockOnuRepo.count
      .mockResolvedValueOnce(45) // active
      .mockResolvedValueOnce(3); // blocked/offline

    mockCompanyRepo.findOne.mockResolvedValue({
      telegramAlertsEnabled: false,
    });

    const metric = await service.collectAndRecordMetrics('olt-1');

    expect(metric).toBeDefined();
    expect(metric.oltId).toBe('olt-1');
    expect(metric.activeOnusCount).toBe(45);
    expect(metric.cardsInfo).toHaveLength(5);
    expect(mockMetricRepo.save).toHaveBeenCalled();
    expect(mockMetricRepo.delete).toHaveBeenCalled(); // 30-day retention cleanup
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
