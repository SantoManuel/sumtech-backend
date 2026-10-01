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

    it('respeta plan.pppProfileId personalizado en vez de forzar el autogenerado (Punto B)', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      planRepo.find.mockResolvedValue([
        { id: 'plan-custom', name: 'Plan Especial', speedMbps: 30, pppProfileId: 'sumtech-especial', isActive: true },
      ]);

      const ensureSuspensionProfile = jest.fn().mockResolvedValue(undefined);
      const ensureProfile = jest.fn().mockResolvedValue({ id: '*2', name: 'sumtech-especial' });

      clientFactory.mockReturnValue({
        ensureSuspensionProfile,
        ensureProfile,
      });

      const result = await service.syncCatalogProfilesToNode('node-1');

      expect(result.syncedProfiles[0].profileName).toBe('sumtech-especial');
      expect(ensureProfile).toHaveBeenCalledWith(
        'sumtech-especial',
        '30M/30M',
        expect.anything(),
      );
    });
  });

  describe('getNodeProfiles', () => {
    it('devuelve perfiles enriquecidos con métricas de secretos, asignación dinámica/fija y planes asociados', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      planRepo.find.mockResolvedValue([
        { id: 'plan-20', name: 'Plan 20 Mbps', speedMbps: 20, pppProfileId: 'sumtech-20', isActive: true },
      ]);

      const mockProfiles = [
        { id: '*1', name: 'default', rateLimit: '10M/10M', localAddress: '10.0.0.1', remoteAddress: 'pool-default' },
        { id: '*2', name: 'sumtech-20', rateLimit: '20M/20M', localAddress: '10.0.0.1', remoteAddress: 'pool-clientes' },
      ];
      const mockSecrets = [
        { id: '*s1', name: 'user_dynamic', profile: 'sumtech-20', remoteAddress: '' },
        { id: '*s2', name: 'user_static', profile: 'sumtech-20', remoteAddress: '100.64.0.25' },
        { id: '*s3', name: 'user_other', profile: 'default' },
      ];
      const mockActiveSessions = [
        { id: '*a1', name: 'user_dynamic', address: '100.64.0.10' },
      ];
      const mockPools = [{ id: '*p1', name: 'pool-clientes', ranges: '100.64.0.2-100.64.0.254' }];

      clientFactory.mockReturnValue({
        getProfiles: jest.fn().mockResolvedValue(mockProfiles),
        getPppSecrets: jest.fn().mockResolvedValue(mockSecrets),
        getActiveSessions: jest.fn().mockResolvedValue(mockActiveSessions),
        getIpPools: jest.fn().mockResolvedValue(mockPools),
      });

      const result = await service.getNodeProfiles('node-1');

      expect(result.profiles).toHaveLength(2);
      const profile20 = result.profiles.find((p) => p.name === 'sumtech-20');
      expect(profile20).toBeDefined();
      expect(profile20?.secretsCount).toBe(2);
      expect(profile20?.dynamicIpCount).toBe(1);
      expect(profile20?.staticIpCount).toBe(1);
      expect(profile20?.activeSessionsCount).toBe(1);
      expect(profile20?.associatedPlans).toEqual([{ id: 'plan-20', name: 'Plan 20 Mbps', speedMbps: 20 }]);
      expect(profile20?.isProtected).toBe(false);

      const defaultProfile = result.profiles.find((p) => p.name === 'default');
      expect(defaultProfile?.isProtected).toBe(true);
    });
  });

  describe('createNodeProfile', () => {
    it('crea un perfil nuevo en el router si no existe y registra auditoría', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      const findProfileByName = jest.fn().mockResolvedValue(null);
      const createProfile = jest.fn().mockResolvedValue({ id: '*10', name: 'Plan-100M', rateLimit: '100M/100M' });

      clientFactory.mockReturnValue({ findProfileByName, createProfile });

      const dto = {
        name: 'Plan-100M',
        rateLimit: '100M/100M',
        parentQueue: 'Total-Bandwidth',
        localAddress: '100.64.0.1',
        remoteAddress: 'pool-clientes',
        onlyOne: true,
      };

      const result = await service.createNodeProfile('node-1', dto, 'admin-id');

      expect(result.id).toBe('*10');
      expect(createProfile).toHaveBeenCalledWith('Plan-100M', '100M/100M', expect.objectContaining({
        parentQueue: 'Total-Bandwidth',
        localAddress: '100.64.0.1',
        remoteAddress: 'pool-clientes',
        onlyOne: true,
      }));
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'PROVISION', actorUserId: 'admin-id' }),
      );
    });

    it('rechaza con BadRequestException si el nombre ya existe', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      clientFactory.mockReturnValue({
        findProfileByName: jest.fn().mockResolvedValue({ id: '*1', name: 'Plan-100M' }),
      });

      await expect(
        service.createNodeProfile('node-1', { name: 'Plan-100M', rateLimit: '100M/100M' }),
      ).rejects.toThrow(/Ya existe un perfil/);
    });
  });

  describe('deleteNodeProfile', () => {
    it('rechaza borrar perfiles protegidos como default o Sumtech-Corte', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      clientFactory.mockReturnValue({
        getProfiles: jest.fn().mockResolvedValue([{ id: '*1', name: 'Sumtech-Corte' }]),
      });

      await expect(service.deleteNodeProfile('node-1', '*1')).rejects.toThrow(/perfil protegido/);
    });

    it('rechaza borrar perfil si tiene secretos asignados', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      clientFactory.mockReturnValue({
        getProfiles: jest.fn().mockResolvedValue([{ id: '*2', name: 'sumtech-20' }]),
        getPppSecrets: jest.fn().mockResolvedValue([{ id: '*s1', name: 'cliente_1', profile: 'sumtech-20' }]),
      });

      await expect(service.deleteNodeProfile('node-1', '*2')).rejects.toThrow(/secretos\/clientes asignados/);
    });

    it('rechaza borrar perfil si está vinculado a un plan comercial activo', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      planRepo.find.mockResolvedValue([
        { id: 'p1', name: 'Plan 20 Mbps', pppProfileId: 'sumtech-20', isActive: true },
      ]);
      clientFactory.mockReturnValue({
        getProfiles: jest.fn().mockResolvedValue([{ id: '*2', name: 'sumtech-20' }]),
        getPppSecrets: jest.fn().mockResolvedValue([]),
      });

      await expect(service.deleteNodeProfile('node-1', '*2')).rejects.toThrow(/vinculado al plan comercial/);
    });

    it('elimina el perfil exitosamente si no tiene dependencias', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      planRepo.find.mockResolvedValue([]);
      const deleteProfile = jest.fn().mockResolvedValue(undefined);
      clientFactory.mockReturnValue({
        getProfiles: jest.fn().mockResolvedValue([{ id: '*2', name: 'sumtech-viejo' }]),
        getPppSecrets: jest.fn().mockResolvedValue([]),
        deleteProfile,
      });

      const res = await service.deleteNodeProfile('node-1', '*2', 'admin-id');

      expect(res.success).toBe(true);
      expect(deleteProfile).toHaveBeenCalledWith('*2');
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'COMMAND', actorUserId: 'admin-id' }),
      );
    });
  });
});
