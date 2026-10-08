import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OltNatManagerService } from './olt-nat-manager.service';
import { OltEntity } from '../entities/olt.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ROUTEROS_CLIENT_FACTORY } from '../../network/routeros/routeros-client-factory';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { encryptCredential } from '../../network-connectivity/utils/crypto.util';

describe('OltNatManagerService', () => {
  let service: OltNatManagerService;
  let oltRepo: any;
  let nodeRepo: any;
  let clientFactory: jest.Mock;
  let reachabilityResolver: any;
  let deviceOperationLogger: any;

  const mockOlt = {
    id: 'olt-1',
    name: 'OLT-Azua_',
    connectionMethod: 'VIA_MIKROTIK',
    viaNodeId: 'node-1',
    natPort: 2324,
    host: '192.168.0.88',
    port: 23,
  } as unknown as OltEntity;

  const realPassword = '12345678';
  const mockNode = {
    id: 'node-1',
    name: 'Azua-Centro',
    apiUser: 'admin',
    apiPasswordEnc: encryptCredential(realPassword),
  } as unknown as NetworkNodeEntity;

  beforeEach(async () => {
    oltRepo = { findOneBy: jest.fn().mockResolvedValue(mockOlt) };
    nodeRepo = { findOneBy: jest.fn().mockResolvedValue(mockNode) };

    const fakeRouterOsClient = {
      http: {
        get: jest.fn().mockResolvedValue({ data: [] }),
        put: jest.fn().mockResolvedValue({ data: {} }),
        patch: jest.fn().mockResolvedValue({ data: {} }),
      },
      buildUrl: jest.fn((p: string) => p),
      buildRequestConfig: jest.fn(() => ({})),
    };
    clientFactory = jest.fn().mockReturnValue(fakeRouterOsClient);

    reachabilityResolver = {
      resolveEndpoint: jest.fn().mockResolvedValue({ host: '172.16.100.5', port: 80, useHttps: false }),
    };
    deviceOperationLogger = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OltNatManagerService,
        { provide: getRepositoryToken(OltEntity), useValue: oltRepo },
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: ROUTEROS_CLIENT_FACTORY, useValue: clientFactory },
        { provide: ReachabilityResolver, useValue: reachabilityResolver },
        { provide: DeviceOperationLogger, useValue: deviceOperationLogger },
      ],
    }).compile();

    service = module.get<OltNatManagerService>(OltNatManagerService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('descifra apiPasswordEnc antes de construir el cliente RouterOS (regresión: antes se mandaba el blob cifrado tal cual)', async () => {
    await service.ensureOltNatRule('olt-1', 'admin-id');

    expect(clientFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'admin',
        password: realPassword,
      }),
    );
  });

  it('lanza BadRequestException si la OLT no usa VIA_MIKROTIK', async () => {
    oltRepo.findOneBy.mockResolvedValue({ ...mockOlt, connectionMethod: 'WIREGUARD' });
    await expect(service.ensureOltNatRule('olt-1')).rejects.toThrow(BadRequestException);
  });

  it('lanza NotFoundException si el router MikroTik asignado no existe', async () => {
    nodeRepo.findOneBy.mockResolvedValue(null);
    await expect(service.ensureOltNatRule('olt-1')).rejects.toThrow(NotFoundException);
  });
});
