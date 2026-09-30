import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PppManagementService } from './ppp-management.service';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { NetworkAccessEntity } from '../entities/network-access.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { ROUTEROS_CLIENT_FACTORY } from '../routeros/routeros-client-factory';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';

describe('PppManagementService', () => {
  let service: PppManagementService;
  let nodeRepo: any;
  let accessRepo: any;
  let planRepo: any;
  let clientFactory: jest.Mock;
  let reachabilityResolver: any;
  let deviceOperationLogger: any;

  const mockNode = {
    id: 'node-1',
    name: 'RB Core',
    managementIp: '10.0.0.1',
    apiPort: 8729,
    useHttps: false,
    defaultParentQueue: 'Total-Bandwidth',
    defaultPppPool: 'pool-clientes',
  } as NetworkNodeEntity;

  const mockAccess = {
    id: 'access-1',
    contractId: 'contract-1',
    nodeId: 'node-1',
    username: 'cliente_test',
    connectionStatus: 'ACTIVE',
  } as NetworkAccessEntity;

  beforeEach(async () => {
    nodeRepo = {
      findOneBy: jest.fn(),
    };
    accessRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    planRepo = {
      find: jest.fn(),
    };
    clientFactory = jest.fn();
    reachabilityResolver = {
      resolveEndpoint: jest.fn().mockResolvedValue({
        host: '10.0.0.1',
        port: 8729,
        useHttps: false,
        method: 'API',
      }),
    };
    deviceOperationLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PppManagementService,
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(NetworkAccessEntity), useValue: accessRepo },
        { provide: getRepositoryToken(PlanEntity), useValue: planRepo },
        { provide: ROUTEROS_CLIENT_FACTORY, useValue: clientFactory },
        { provide: ReachabilityResolver, useValue: reachabilityResolver },
        { provide: DeviceOperationLogger, useValue: deviceOperationLogger },
      ],
    }).compile();

    service = module.get<PppManagementService>(PppManagementService);
    process.env.ROUTEROS_CREDENTIALS = JSON.stringify({
      'RB Core': { username: 'admin', password: 'password' },
    });
  });

  afterEach(() => {
    delete process.env.ROUTEROS_CREDENTIALS;
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('getNodeActiveSessions', () => {
    it('obtiene la lista de sesiones activas desde el router', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      const activeSessions = [
        { id: '*1', name: 'cliente_test', address: '10.0.1.20', uptime: '2h15m', callerId: '48:8F:5A:11:22:33' },
      ];
      clientFactory.mockReturnValue({
        getActiveSessions: jest.fn().mockResolvedValue(activeSessions),
      });

      const result = await service.getNodeActiveSessions('node-1');

      expect(result.sessions).toHaveLength(1);
      expect(result.totalActive).toBe(1);
      expect(result.sessions[0].name).toBe('cliente_test');
      expect(result.sessions[0].callerId).toBe('48:8F:5A:11:22:33');
    });

    it('lanza NotFoundException si el nodo no existe', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);

      await expect(service.getNodeActiveSessions('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAccessSession', () => {
    it('devuelve la sesión en vivo y actualiza la MAC detectada', async () => {
      accessRepo.findOne.mockResolvedValue({ ...mockAccess, node: mockNode });
      clientFactory.mockReturnValue({
        findActiveSessionByName: jest.fn().mockResolvedValue({
          id: '*1',
          name: 'cliente_test',
          address: '10.0.1.20',
          uptime: '15m',
          callerId: 'AA:BB:CC:DD:EE:FF',
        }),
      });

      const session = await service.getAccessSession('access-1');

      expect(session.isConnected).toBe(true);
      expect(session.callerId).toBe('AA:BB:CC:DD:EE:FF');
      expect(accessRepo.update).toHaveBeenCalledWith(
        { id: 'access-1' },
        { macAddress: 'AA:BB:CC:DD:EE:FF', lastCallerId: 'AA:BB:CC:DD:EE:FF' },
      );
    });

    it('devuelve isConnected:false si no hay sesión activa en el router', async () => {
      accessRepo.findOne.mockResolvedValue({ ...mockAccess, node: mockNode });
      clientFactory.mockReturnValue({
        findActiveSessionByName: jest.fn().mockResolvedValue(null),
      });

      const session = await service.getAccessSession('access-1');

      expect(session.isConnected).toBe(false);
      expect(accessRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('disconnectAccessSession', () => {
    it('desconecta en caliente la sesión activa y registra el evento', async () => {
      accessRepo.findOne.mockResolvedValue({ ...mockAccess, node: mockNode });
      const killActiveSession = jest.fn().mockResolvedValue(true);
      clientFactory.mockReturnValue({
        findActiveSessionByName: jest.fn().mockResolvedValue({
          id: '*1',
          name: 'cliente_test',
          callerId: 'AA:BB:CC:DD:EE:FF',
        }),
        killActiveSession,
      });

      const result = await service.disconnectAccessSession('access-1', 'admin-user-id');

      expect(result.success).toBe(true);
      expect(killActiveSession).toHaveBeenCalledWith('cliente_test');
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'COMMAND',
          status: 'SUCCESS',
          actorUserId: 'admin-user-id',
        }),
      );
    });
  });

  describe('syncCatalogProfilesToNode', () => {
    it('sincroniza perfil de corte y perfiles comerciales con colas y pools', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      planRepo.find.mockResolvedValue([
        { id: 'plan-1', name: 'Plan 20M', speedMbps: 20, isActive: true },
        { id: 'plan-2', name: 'Plan 50M', speedMbps: 50, isActive: true },
      ]);

      const ensureSuspensionProfile = jest.fn().mockResolvedValue(undefined);
      const ensureProfile = jest.fn().mockResolvedValue({ id: '*1', name: 'Sumtech-20Mbps' });

      clientFactory.mockReturnValue({
        ensureSuspensionProfile,
        ensureProfile,
      });

      const result = await service.syncCatalogProfilesToNode('node-1', 'admin-user-id');

      expect(result.nodeId).toBe('node-1');
      expect(result.syncedProfiles).toHaveLength(2);
      expect(ensureSuspensionProfile).toHaveBeenCalledWith('Sumtech-Corte', '256k/256k');
      expect(ensureProfile).toHaveBeenCalledWith(
        'Sumtech-20Mbps',
        '20M/20M',
        expect.objectContaining({
          parentQueue: 'Total-Bandwidth',
          remoteAddress: 'pool-clientes',
          onlyOne: true,
        }),
      );
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'PROVISION',
          status: 'SUCCESS',
          actorUserId: 'admin-user-id',
        }),
      );
    });
  });
});
