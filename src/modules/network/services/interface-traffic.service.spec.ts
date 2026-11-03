import { Test, TestingModule } from '@nestjs/testing';
import { InterfaceTrafficService } from './interface-traffic.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { RouterOsClientResolverService } from './routeros-client-resolver.service';

describe('InterfaceTrafficService', () => {
  let service: InterfaceTrafficService;
  let nodeRepo: any;
  let clientResolver: any;

  const mockNode = {
    id: 'node-1',
    name: 'RB-Azua-Centro',
    status: 'ACTIVE',
  };

  const mockClient = {
    getInterfaces: jest.fn(),
    getInterfaceTrafficSample: jest.fn(),
  };

  beforeEach(async () => {
    nodeRepo = {
      findOne: jest.fn().mockResolvedValue(mockNode),
    };

    clientResolver = {
      resolveClient: jest.fn().mockResolvedValue(mockClient),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InterfaceTrafficService,
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: RouterOsClientResolverService, useValue: clientResolver },
      ],
    }).compile();

    service = module.get<InterfaceTrafficService>(InterfaceTrafficService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('getNodeInterfaces retorna lista de interfaces del router', async () => {
    mockClient.getInterfaces.mockResolvedValue([
      { name: 'ether1', type: 'ether', running: true },
      { name: 'sfp-sfpplus1', type: 'ether', running: true },
    ]);

    const ifaces = await service.getNodeInterfaces('node-1');
    expect(ifaces).toHaveLength(2);
    expect(ifaces[0].name).toBe('ether1');
    expect(ifaces[0].running).toBe(true);
  });

  it('getInterfaceTraffic consulta el tráfico en vivo y acumula muestras', async () => {
    mockClient.getInterfaceTrafficSample.mockResolvedValue({
      rxBps: 45000000,
      txBps: 15000000,
    });

    const res = await service.getInterfaceTraffic('node-1', 'ether1');

    expect(res).toBeDefined();
    expect(res.currentRxBps).toBe(45000000);
    expect(res.currentTxBps).toBe(15000000);
    expect(res.samples).toHaveLength(1);
    expect(res.maxRxBps).toBe(45000000);
    expect(res.avgRxBps).toBe(45000000);
  });
});
