import { NetworkNodesExportService } from './network-nodes-export.service';
import { NetworkNodeEntity } from '../entities/network-node.entity';

describe('NetworkNodesExportService', () => {
  let service: NetworkNodesExportService;
  let queryBuilder: any;
  let nodeRepo: any;

  const makeNode = (overrides: Partial<NetworkNodeEntity> = {}): NetworkNodeEntity =>
    ({
      id: 'node-1',
      name: 'RB Las Yayas',
      model: 'CCR2004',
      connectionMethod: 'wireguard',
      wireguardIp: '10.254.1.2',
      status: 'ACTIVE',
      routerosVersion: '7.15',
      cpuUsage: 12,
      uptimeSeconds: 3600,
      lastHeartbeatAt: new Date('2026-10-10T12:00:00Z'),
      isActive: true,
      zone: { id: 'zone-1', name: 'Azua' } as any,
      ...overrides,
    }) as NetworkNodeEntity;

  beforeEach(() => {
    queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([makeNode()]),
    };

    nodeRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };

    service = new NetworkNodesExportService(nodeRepo);
  });

  it('arma el CSV con BOM y encabezado esperado', async () => {
    const result = await service.export({});
    expect(result.contentType).toBe('text/csv; charset=utf-8');
    const text = result.buffer.toString('utf8').replace(/^﻿/, '');
    expect(text.split('\r\n')[0]).toContain('Nombre');
    expect(text).toContain('RB Las Yayas');
    expect(text).toContain('Azua');
  });

  it('solo filtra por deletedAt cuando no hay search/status/connectionMethod', async () => {
    await service.export({});
    expect(queryBuilder.andWhere).not.toHaveBeenCalled();
  });

  it('aplica andWhere de status, connectionMethod y search cuando vienen en el DTO', async () => {
    await service.export({ status: 'ACTIVE', connectionMethod: 'wireguard', search: 'Azua' });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('node.status = :status', { status: 'ACTIVE' });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('node.connectionMethod = :method', { method: 'wireguard' });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('node.name ILIKE :search'), {
      search: '%Azua%',
    });
  });

  it('usa el límite por defecto cuando el DTO no trae limit', async () => {
    await service.export({});
    expect(queryBuilder.take).toHaveBeenCalledWith(5000);
  });

  it('respeta el limit explícito del DTO', async () => {
    await service.export({ limit: 50 });
    expect(queryBuilder.take).toHaveBeenCalledWith(50);
  });

  it('nunca imprime "undefined" para campos opcionales ausentes', async () => {
    queryBuilder.getMany.mockResolvedValueOnce([
      makeNode({ model: undefined, routerosVersion: undefined, cpuUsage: undefined, uptimeSeconds: undefined, lastHeartbeatAt: undefined, zone: undefined }),
    ]);
    const result = await service.export({});
    const text = result.buffer.toString('utf8');
    expect(text).not.toContain('undefined');
  });
});
