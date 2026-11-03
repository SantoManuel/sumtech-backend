import { Test, TestingModule } from '@nestjs/testing';
import { GisTopologyService } from './gis-topology.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NapBoxEntity } from '../entities/nap-box.entity';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { OltEntity } from '../../olt/entities/olt.entity';
import { AddressEntity } from '../../clients/entities/address.entity';
import { OnuEntity } from '../../olt/entities/onu.entity';

describe('GisTopologyService', () => {
  let service: GisTopologyService;
  let napBoxRepo: any;
  let nodeRepo: any;
  let oltRepo: any;
  let addressRepo: any;
  let onuRepo: any;

  const mockNapBoxRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockNodeRepo = {
    find: jest.fn(),
  };

  const mockOltRepo = {
    find: jest.fn(),
  };

  const mockAddressRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockOnuRepo = {
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GisTopologyService,
        { provide: getRepositoryToken(NapBoxEntity), useValue: mockNapBoxRepo },
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: mockNodeRepo },
        { provide: getRepositoryToken(OltEntity), useValue: mockOltRepo },
        { provide: getRepositoryToken(AddressEntity), useValue: mockAddressRepo },
        { provide: getRepositoryToken(OnuEntity), useValue: mockOnuRepo },
      ],
    }).compile();

    service = module.get<GisTopologyService>(GisTopologyService);
    napBoxRepo = module.get(getRepositoryToken(NapBoxEntity));
    nodeRepo = module.get(getRepositoryToken(NetworkNodeEntity));
    oltRepo = module.get(getRepositoryToken(OltEntity));
    addressRepo = module.get(getRepositoryToken(AddressEntity));
    onuRepo = module.get(getRepositoryToken(OnuEntity));
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('getTopology retorna resumen, naps, olts, nodos, abonados y líneas de fibra', async () => {
    const qbNap: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'nap-1',
          name: 'NAP-Centro-01',
          totalPorts: 16,
          latitude: 18.4861,
          longitude: -69.9312,
          splitterRatio: '1:16',
          ports: [
            {
              portNumber: 1,
              onuId: 'onu-1',
              onu: {
                id: 'onu-1',
                serialNumber: 'ZTEGC1234567',
                rxPowerDbm: -19.5,
                status: 'ACTIVE',
                contract: {
                  clientId: 'client-1',
                  client: { name: 'Juan Perez' },
                },
              },
            },
          ],
        },
      ]),
    };
    mockNapBoxRepo.createQueryBuilder.mockReturnValue(qbNap);

    mockOltRepo.find.mockResolvedValue([
      { id: 'olt-1', name: 'OLT-Azua', vendor: 'ZTE', model: 'C320', status: 'ACTIVO' },
    ]);

    mockNodeRepo.find.mockResolvedValue([
      { id: 'node-1', name: 'RB-Principal', model: 'CCR1009', status: 'ACTIVE' },
    ]);

    const qbOnu: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'onu-1',
          serialNumber: 'ZTEGC1234567',
          rxPowerDbm: -19.5,
          status: 'ACTIVE',
          contractId: 'contract-1',
          contract: {
            clientId: 'client-1',
            client: { name: 'Juan Perez', docNumber: '001-0000000-1' },
            address: { gpsLatitude: 18.4870, gpsLongitude: -69.9320 },
          },
          napPort: {
            portNumber: 1,
            nap: { id: 'nap-1', name: 'NAP-Centro-01' },
          },
        },
      ]),
    };
    mockOnuRepo.createQueryBuilder.mockReturnValue(qbOnu);

    const result = await service.getTopology();

    expect(result).toBeDefined();
    expect(result.summary.totalNaps).toBe(1);
    expect(result.summary.georeferencedNaps).toBe(1);
    expect(result.naps).toHaveLength(1);
    expect(result.naps[0].availablePorts).toBe(15);
    expect(result.subscribers).toHaveLength(1);
    expect(result.fiberLines).toHaveLength(1);
    expect(result.fiberLines[0].type).toBe('DROP');
  });

  it('updateNapCoordinates actualiza y guarda las coordenadas de la caja NAP', async () => {
    mockNapBoxRepo.findOne.mockResolvedValue({
      id: 'nap-1',
      name: 'NAP-1',
      latitude: null,
      longitude: null,
    });
    mockNapBoxRepo.save.mockImplementation(async (item: any) => item);

    const res = await service.updateNapCoordinates('nap-1', {
      latitude: 18.4855,
      longitude: -69.9300,
    });

    expect(res.latitude).toBe(18.4855);
    expect(res.longitude).toBe(-69.9300);
    expect(mockNapBoxRepo.save).toHaveBeenCalled();
  });
});
