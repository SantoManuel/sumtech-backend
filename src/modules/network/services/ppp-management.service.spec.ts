import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, GatewayTimeoutException, BadRequestException } from '@nestjs/common';
import { PppManagementService, expandIpPoolRanges } from './ppp-management.service';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { NetworkAccessEntity } from '../entities/network-access.entity';
import { NetworkNodeVlanEntity } from '../entities/network-node-vlan.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { RouterOsClientResolverService } from './routeros-client-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';

describe('PppManagementService', () => {
  let service: PppManagementService;
  let nodeRepo: any;
  let accessRepo: any;
  let nodeVlanRepo: any;
  let planRepo: any;
  let clientFactory: jest.Mock;
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
      createQueryBuilder: jest.fn(),
    };
    nodeVlanRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    planRepo = {
      find: jest.fn(),
    };
    clientFactory = jest.fn();
    deviceOperationLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PppManagementService,
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(NetworkAccessEntity), useValue: accessRepo },
        { provide: getRepositoryToken(NetworkNodeVlanEntity), useValue: nodeVlanRepo },
        { provide: getRepositoryToken(PlanEntity), useValue: planRepo },
        { provide: RouterOsClientResolverService, useValue: { resolveClient: clientFactory } },
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

  describe('disconnectNodeActiveSession', () => {
    it('desconecta en caliente la sesión activa de un usuario por routerId y username', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      const killActiveSession = jest.fn().mockResolvedValue(true);
      clientFactory.mockReturnValue({
        killActiveSession,
      });

      const result = await service.disconnectNodeActiveSession('node-1', 'usuario_pppoe', 'admin-user-id');

      expect(result.success).toBe(true);
      expect(killActiveSession).toHaveBeenCalledWith('usuario_pppoe');
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'node-1',
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

      const result = await service.syncCatalogProfilesToNode('node-1', undefined, 'admin-user-id');

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

    it('sincroniza únicamente los planes especificados en planIds (sincronización selectiva)', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      planRepo.find.mockResolvedValue([
        { id: 'plan-1', name: 'Plan 20M', speedMbps: 20, isActive: true },
        { id: 'plan-2', name: 'Plan 50M', speedMbps: 50, isActive: true },
        { id: 'plan-3', name: 'Plan 100M', speedMbps: 100, isActive: true },
      ]);

      const ensureSuspensionProfile = jest.fn().mockResolvedValue(undefined);
      const ensureProfile = jest.fn().mockResolvedValue({ id: '*1' });

      clientFactory.mockReturnValue({ ensureSuspensionProfile, ensureProfile });

      const result = await service.syncCatalogProfilesToNode('node-1', {
        planIds: ['plan-2'],
      });

      expect(result.syncedProfiles).toHaveLength(1);
      expect(result.syncedProfiles[0].planId).toBe('plan-2');
      expect(ensureProfile).toHaveBeenCalledTimes(1);
      expect(ensureProfile).toHaveBeenCalledWith('Sumtech-50Mbps', '50M/50M', expect.anything());
    });

    it('aplica poolOverride y parentQueueOverride cuando se especifican en el lote', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      planRepo.find.mockResolvedValue([
        { id: 'plan-1', name: 'Plan 20M', speedMbps: 20, isActive: true },
      ]);

      const ensureSuspensionProfile = jest.fn().mockResolvedValue(undefined);
      const ensureProfile = jest.fn().mockResolvedValue({ id: '*1' });

      clientFactory.mockReturnValue({ ensureSuspensionProfile, ensureProfile });

      const result = await service.syncCatalogProfilesToNode('node-1', {
        poolOverride: 'pool-empresarial',
        parentQueueOverride: 'Queue-VIP',
        includeSuspensionProfile: false,
      });

      expect(ensureSuspensionProfile).not.toHaveBeenCalled();
      expect(ensureProfile).toHaveBeenCalledWith(
        'Sumtech-20Mbps',
        '20M/20M',
        expect.objectContaining({
          remoteAddress: 'pool-empresarial',
          parentQueue: 'Queue-VIP',
        }),
      );
      expect(result.syncedProfiles[0].pool).toBe('pool-empresarial');
      expect(result.syncedProfiles[0].parentQueue).toBe('Queue-VIP');
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

    it('lanza GatewayTimeoutException si client.getProfiles falla por timeout', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      clientFactory.mockReturnValue({
        getProfiles: jest.fn().mockRejectedValue(new Error('Tiempo de espera agotado contactando al nodo.')),
        getPppSecrets: jest.fn().mockResolvedValue([]),
        getActiveSessions: jest.fn().mockResolvedValue([]),
        getIpPools: jest.fn().mockResolvedValue([]),
      });

      await expect(service.getNodeProfiles('node-1')).rejects.toThrow(GatewayTimeoutException);
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

  describe('IP Pools CRUD y Burst Rate-Limit', () => {
    it('createNodeIpPool crea el pool y registra la operación', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      const createIpPool = jest.fn().mockResolvedValue({ id: '*P1', name: 'pool-nuevo', ranges: '10.80.0.10-10.80.0.250' });
      clientFactory.mockReturnValue({ createIpPool });

      const res = await service.createNodeIpPool('node-1', { name: 'pool-nuevo', ranges: '10.80.0.10-10.80.0.250' }, 'admin-1');

      expect(res.name).toBe('pool-nuevo');
      expect(createIpPool).toHaveBeenCalledWith('pool-nuevo', '10.80.0.10-10.80.0.250');
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'PROVISION' }));
    });

    it('updateNodeIpPool actualiza rangos de un pool existente', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      const updateIpPool = jest.fn().mockResolvedValue({ id: '*P1', name: 'pool-nuevo', ranges: '10.80.0.50-10.80.0.250' });
      clientFactory.mockReturnValue({ updateIpPool });

      const res = await service.updateNodeIpPool('node-1', '*P1', { ranges: '10.80.0.50-10.80.0.250' }, 'admin-1');

      expect(updateIpPool).toHaveBeenCalledWith('*P1', '10.80.0.50-10.80.0.250');
      expect(res.ranges).toBe('10.80.0.50-10.80.0.250');
    });

    it('deleteNodeIpPool elimina el pool por ID', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      const deleteIpPool = jest.fn().mockResolvedValue(undefined);
      clientFactory.mockReturnValue({ deleteIpPool });

      const res = await service.deleteNodeIpPool('node-1', '*P1', 'admin-1');

      expect(deleteIpPool).toHaveBeenCalledWith('*P1');
      expect(res.ok).toBe(true);
    });

    it('createNodeProfile formatea parámetros de QoS/burst si se proveen', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      const createProfile = jest.fn().mockResolvedValue({ id: '*P99', name: 'plan-burst' });
      clientFactory.mockReturnValue({
        findProfileByName: jest.fn().mockResolvedValue(null),
        createProfile,
      });

      await service.createNodeProfile('node-1', {
        name: 'plan-burst',
        rateLimit: '20M/20M',
        burstLimit: '40M/40M',
        burstThreshold: '25M/25M',
        burstTime: '16/16',
        priority: 4,
      });

      expect(createProfile).toHaveBeenCalledWith(
        'plan-burst',
        '20M/20M 40M/40M 25M/25M 16/16 4',
        expect.anything(),
      );
    });
  });

  describe('expandIpPoolRanges', () => {
    it('expande un único rango a todas sus direcciones', () => {
      expect(expandIpPoolRanges('192.168.60.1-192.168.60.3')).toEqual([
        '192.168.60.1',
        '192.168.60.2',
        '192.168.60.3',
      ]);
    });

    it('soporta múltiples rangos/IPs sueltas separadas por coma', () => {
      expect(expandIpPoolRanges('10.0.0.5,10.0.0.10-10.0.0.11')).toEqual([
        '10.0.0.5',
        '10.0.0.10',
        '10.0.0.11',
      ]);
    });

    it('ignora un rango invertido o mal formado sin reventar', () => {
      expect(expandIpPoolRanges('10.0.0.20-10.0.0.10')).toEqual([]);
      expect(expandIpPoolRanges('no-es-una-ip')).toEqual([]);
    });

    it('respeta el límite máximo de direcciones a expandir', () => {
      expect(expandIpPoolRanges('10.0.0.0-10.0.0.255', 10)).toHaveLength(10);
    });
  });

  describe('getAvailableIps', () => {
    const makeAccessQueryBuilder = (rows: Array<{ ipAddress: string }>) => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    });

    it('calcula las IPs libres cruzando el rango del pool con la BD, los secrets y el pool/used del router', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      accessRepo.createQueryBuilder.mockReturnValue(
        makeAccessQueryBuilder([{ ipAddress: '10.0.1.2' }]),
      );
      clientFactory.mockReturnValue({
        getIpPools: jest.fn().mockResolvedValue([
          { id: '*1', name: 'pool-clientes', ranges: '10.0.1.1-10.0.1.5' },
        ]),
        getPppSecrets: jest.fn().mockResolvedValue([
          { id: '*s1', name: 'cliente_a', profile: 'default', remoteAddress: '10.0.1.3' },
        ]),
        getUsedPoolAddresses: jest.fn().mockResolvedValue(['10.0.1.4']),
      });

      const result = await service.getAvailableIps('node-1');

      expect(result.poolName).toBe('pool-clientes');
      expect(result.totalInRange).toBe(5);
      expect(result.totalUsed).toBe(3); // .2 (BD) + .3 (secret) + .4 (pool/used)
      expect(result.available).toEqual(['10.0.1.1', '10.0.1.5']);
      expect(result.totalAvailable).toBe(2);
    });

    it('usa el pool explícito del query param en vez del defaultPppPool del nodo', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      accessRepo.createQueryBuilder.mockReturnValue(makeAccessQueryBuilder([]));
      const getIpPools = jest.fn().mockResolvedValue([
        { id: '*1', name: 'pool-clientes', ranges: '10.0.1.1-10.0.1.2' },
        { id: '*2', name: 'pool-vip', ranges: '10.0.9.1-10.0.9.2' },
      ]);
      clientFactory.mockReturnValue({
        getIpPools,
        getPppSecrets: jest.fn().mockResolvedValue([]),
        getUsedPoolAddresses: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getAvailableIps('node-1', { poolName: 'pool-vip' });

      expect(result.poolName).toBe('pool-vip');
      expect(result.available).toEqual(['10.0.9.1', '10.0.9.2']);
    });

    it('lanza BadRequestException si el nodo no tiene pool por defecto ni se indica uno explícito', async () => {
      nodeRepo.findOneBy.mockResolvedValue({ ...mockNode, defaultPppPool: undefined });

      await expect(service.getAvailableIps('node-1')).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFoundException si el pool indicado no existe en el router', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      clientFactory.mockReturnValue({
        getIpPools: jest.fn().mockResolvedValue([{ id: '*1', name: 'otro-pool', ranges: '10.0.1.1-10.0.1.2' }]),
      });

      await expect(service.getAvailableIps('node-1')).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si el nodo no existe', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);

      await expect(service.getAvailableIps('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('con vlanId, usa el pool propio de esa VLAN en vez del defaultPppPool del nodo (multi-VLAN)', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      nodeVlanRepo.findOne.mockResolvedValue({ nodeId: 'node-1', vlanId: 'vlan-200', pppPool: 'pool-vlan200' });
      accessRepo.createQueryBuilder.mockReturnValue(makeAccessQueryBuilder([]));
      clientFactory.mockReturnValue({
        getIpPools: jest.fn().mockResolvedValue([
          { id: '*1', name: 'pool-clientes', ranges: '10.0.1.1-10.0.1.2' },
          { id: '*2', name: 'pool-vlan200', ranges: '10.0.200.1-10.0.200.2' },
        ]),
        getPppSecrets: jest.fn().mockResolvedValue([]),
        getUsedPoolAddresses: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getAvailableIps('node-1', { vlanId: 'vlan-200' });

      expect(nodeVlanRepo.findOne).toHaveBeenCalledWith({ where: { nodeId: 'node-1', vlanId: 'vlan-200' } });
      expect(result.poolName).toBe('pool-vlan200');
      expect(result.available).toEqual(['10.0.200.1', '10.0.200.2']);
    });

    it('con vlanId pero sin pool propio para esa VLAN, cae al defaultPppPool del nodo', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      nodeVlanRepo.findOne.mockResolvedValue({ nodeId: 'node-1', vlanId: 'vlan-200', pppPool: undefined });
      accessRepo.createQueryBuilder.mockReturnValue(makeAccessQueryBuilder([]));
      clientFactory.mockReturnValue({
        getIpPools: jest.fn().mockResolvedValue([{ id: '*1', name: 'pool-clientes', ranges: '10.0.1.1-10.0.1.2' }]),
        getPppSecrets: jest.fn().mockResolvedValue([]),
        getUsedPoolAddresses: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getAvailableIps('node-1', { vlanId: 'vlan-200' });

      expect(result.poolName).toBe('pool-clientes');
    });

    it('un poolName explícito gana sobre el pool propio de la VLAN', async () => {
      nodeRepo.findOneBy.mockResolvedValue(mockNode);
      accessRepo.createQueryBuilder.mockReturnValue(makeAccessQueryBuilder([]));
      clientFactory.mockReturnValue({
        getIpPools: jest.fn().mockResolvedValue([{ id: '*1', name: 'pool-manual', ranges: '10.0.9.1-10.0.9.2' }]),
        getPppSecrets: jest.fn().mockResolvedValue([]),
        getUsedPoolAddresses: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getAvailableIps('node-1', { poolName: 'pool-manual', vlanId: 'vlan-200' });

      expect(nodeVlanRepo.findOne).not.toHaveBeenCalled();
      expect(result.poolName).toBe('pool-manual');
    });

    it('lanza BadRequestException con mensaje mencionando la VLAN si ni la VLAN ni el nodo tienen pool', async () => {
      nodeRepo.findOneBy.mockResolvedValue({ ...mockNode, defaultPppPool: undefined });
      nodeVlanRepo.findOne.mockResolvedValue({ nodeId: 'node-1', vlanId: 'vlan-200', pppPool: undefined });

      await expect(service.getAvailableIps('node-1', { vlanId: 'vlan-200' })).rejects.toThrow(
        /Ni la VLAN elegida ni el nodo/,
      );
    });
  });
});
