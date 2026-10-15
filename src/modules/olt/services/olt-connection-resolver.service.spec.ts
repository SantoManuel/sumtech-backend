import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OltConnectionResolverService } from './olt-connection-resolver.service';
import { OltEntity } from '../entities/olt.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { encryptCredential } from '../../network-connectivity/utils/crypto.util';

describe('OltConnectionResolverService', () => {
  let service: OltConnectionResolverService;
  let nodeRepo: any;
  let reachabilityResolver: any;

  const makeOlt = (overrides: Partial<OltEntity> = {}): OltEntity =>
    ({
      id: 'olt-1',
      name: 'OLT Azua',
      host: '192.168.0.88',
      port: 23,
      username: 'admin',
      passwordEnc: encryptCredential('admin'),
      connectionMethod: 'DIRECT',
      ...overrides,
    }) as OltEntity;

  beforeEach(async () => {
    nodeRepo = { findOneBy: jest.fn() };
    reachabilityResolver = { resolveEndpoint: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OltConnectionResolverService,
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: ReachabilityResolver, useValue: reachabilityResolver },
      ],
    }).compile();

    service = module.get(OltConnectionResolverService);
  });

  it('OLT con connectionMethod DIRECT usa host/port propios tal cual', async () => {
    const result = await service.resolve(makeOlt());

    expect(result.host).toBe('192.168.0.88');
    expect(result.port).toBe(23);
    expect(result.username).toBe('admin');
    expect(result.password).toBe('admin');
    expect(nodeRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('OLT con connectionMethod VIA_MIKROTIK resuelve host/port a través del MikroTik, no la IP privada de la OLT', async () => {
    nodeRepo.findOneBy.mockResolvedValue({ id: 'node-1', name: 'Azua-Centro' });
    reachabilityResolver.resolveEndpoint.mockResolvedValue({ host: '172.16.100.5', port: 8729, useHttps: false });

    const olt = makeOlt({ connectionMethod: 'VIA_MIKROTIK', viaNodeId: 'node-1', natPort: 2324 });
    const result = await service.resolve(olt);

    expect(result.host).toBe('172.16.100.5');
    expect(result.port).toBe(2324);
    expect(result.host).not.toBe('192.168.0.88');
    expect(nodeRepo.findOneBy).toHaveBeenCalledWith({ id: 'node-1' });
  });

  it('VIA_MIKROTIK usa el puerto 2323 por defecto si la OLT no tiene natPort configurado', async () => {
    nodeRepo.findOneBy.mockResolvedValue({ id: 'node-1' });
    reachabilityResolver.resolveEndpoint.mockResolvedValue({ host: '172.16.100.5', port: 8729 });

    const result = await service.resolve(makeOlt({ connectionMethod: 'VIA_MIKROTIK', viaNodeId: 'node-1', natPort: undefined }));

    expect(result.port).toBe(2323);
  });

  it('VIA_MIKROTIK sin viaNodeId lanza BadRequestException', async () => {
    const olt = makeOlt({ connectionMethod: 'VIA_MIKROTIK', viaNodeId: undefined });

    await expect(service.resolve(olt)).rejects.toThrow(BadRequestException);
    expect(nodeRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('VIA_MIKROTIK con un nodo MikroTik que ya no existe lanza NotFoundException', async () => {
    nodeRepo.findOneBy.mockResolvedValue(null);
    const olt = makeOlt({ connectionMethod: 'VIA_MIKROTIK', viaNodeId: 'node-borrado' });

    await expect(service.resolve(olt)).rejects.toThrow(NotFoundException);
  });

  it('descifra enablePassword cuando la OLT lo tiene configurado', async () => {
    const olt = makeOlt({ enablePasswordEnc: encryptCredential('enable-secret') });

    const result = await service.resolve(olt);

    expect(result.enablePassword).toBe('enable-secret');
  });

  it('no incluye enablePassword si la OLT no lo tiene configurado', async () => {
    const result = await service.resolve(makeOlt({ enablePasswordEnc: undefined }));

    expect(result.enablePassword).toBeUndefined();
  });
});
