import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { NetworkNodesService } from './network-nodes.service';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { ZoneEntity } from './entities/zone.entity';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { WireguardPeerEntity } from './entities/wireguard-peer.entity';
import { ConnectionTestService } from '../network-connectivity/services/connection-test.service';
import { WireguardManagerService } from '../network-connectivity/services/wireguard-manager.service';
import { WireGuardHubClient } from '../network-connectivity/services/wireguard-hub-client.service';
import { DeviceHealthService } from '../network-connectivity/services/device-health.service';
import { DeviceOperationLogger } from '../network-connectivity/services/device-operation-logger.service';
import { NodePortalRegistryEntity } from '../platform/entities/node-portal-registry.entity';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';

describe('NetworkNodesService', () => {
  let service: NetworkNodesService;
  let nodeRepo: any;
  let zoneRepo: any;
  let queryBuilder: any;
  let wireguardPeerRepo: any;
  let wireGuardHubClient: any;
  let portalRegistryRepo: any;

  const makeNode = (overrides: Partial<NetworkNodeEntity> = {}): NetworkNodeEntity =>
    ({
      id: 'node-1',
      name: 'RB Las Yayas',
      model: undefined,
      managementIp: undefined,
      apiPort: 443,
      useHttps: true,
      zoneId: undefined,
      provisioningMode: 'MANUAL',
      lastSyncAt: undefined,
      lastSyncStatus: 'NEVER',
      isActive: true,
      ...overrides,
    }) as NetworkNodeEntity;

  const makeZone = (overrides: Partial<ZoneEntity> = {}): ZoneEntity =>
    ({ id: 'zone-1', name: 'RB Las Yayas', isActive: true, ...overrides }) as ZoneEntity;

  beforeEach(async () => {
    queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[makeNode()], 1]),
    };

    nodeRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id || 'node-generated', ...entity })),
    };

    zoneRepo = {
      findOneBy: jest.fn(),
    };

    const accessRepo = {
      count: jest.fn().mockResolvedValue(0),
    };

    wireguardPeerRepo = {
      upsert: jest.fn().mockResolvedValue({}),
      findOneBy: jest.fn(),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
    };

    const connectionTestService = {
      executePreflight: jest.fn().mockResolvedValue({ success: true, latencyMs: 12 }),
      testNode: jest.fn().mockResolvedValue({ success: true, latencyMs: 15 }),
    };

    const wireguardManagerService = {
      generateRouterOsScript: jest.fn().mockReturnValue({ routerosScript: '/interface wireguard...', hubPeerCommand: 'wg set wg0 peer TEST allowed-ips 10.254.1.2/32' }),
      generateKeyPair: jest.fn().mockReturnValue({ privateKey: 'test-private-key', publicKey: 'test-public-key' }),
    };

    wireGuardHubClient = {
      registerPeer: jest.fn().mockResolvedValue({ success: false, errorMessage: 'sumtech-wg-agent no configurado' }),
      removePeer: jest.fn().mockResolvedValue({ success: false }),
      getPeerStatus: jest.fn().mockResolvedValue(null),
    };

    const deviceHealthService = {
      checkNodeHealth: jest.fn().mockResolvedValue({ success: true }),
    };

    const deviceOperationLogger = {
      getLogs: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      logEvent: jest.fn().mockResolvedValue({}),
    };

    portalRegistryRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const tenantContext = {
      getTenantId: jest.fn().mockReturnValue('tenant-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworkNodesService,
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(ZoneEntity), useValue: zoneRepo },
        { provide: getRepositoryToken(NetworkAccessEntity), useValue: accessRepo },
        { provide: getRepositoryToken(WireguardPeerEntity), useValue: wireguardPeerRepo },
        { provide: getRepositoryToken(NodePortalRegistryEntity, 'platform'), useValue: portalRegistryRepo },
        { provide: ConnectionTestService, useValue: connectionTestService },
        { provide: WireguardManagerService, useValue: wireguardManagerService },
        { provide: WireGuardHubClient, useValue: wireGuardHubClient },
        { provide: DeviceHealthService, useValue: deviceHealthService },
        { provide: DeviceOperationLogger, useValue: deviceOperationLogger },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get<NetworkNodesService>(NetworkNodesService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('aplica paginación por defecto (page 1, limit 20) y devuelve la forma paginada estándar', async () => {
      const result = await service.findAll();

      expect(result).toEqual({ data: [makeNode()], total: 1, page: 1, limit: 20, totalPages: 1 });
      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(20);
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('node.zone', 'zone');
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('node.name', 'ASC');
    });

    it('filtra por isActive cuando activeOnly=true', async () => {
      await service.findAll({}, true);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('node.isActive = :active', { active: true });
    });

    it('filtra por zoneId cuando se provee', async () => {
      await service.findAll({ zoneId: 'zone-1' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('node.zoneId = :zoneId', { zoneId: 'zone-1' });
    });

    it('no filtra por zoneId cuando no se provee', async () => {
      await service.findAll({});

      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('zoneId'), expect.anything());
    });

    it('filtra por nombre o IP cuando se provee search', async () => {
      await service.findAll({ search: 'Yayas' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(node.name ILIKE :search OR node.managementIp ILIKE :search OR node.wireguardIp ILIKE :search)',
        { search: '%Yayas%' },
      );
    });
  });

  describe('findById', () => {
    it('lanza NotFoundException si el nodo no existe', async () => {
      nodeRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('node-x')).rejects.toThrow(NotFoundException);
    });

    it('devuelve el nodo con su zona precargada', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode());

      const result = await service.findById('node-1');

      expect(result.name).toBe('RB Las Yayas');
      expect(nodeRepo.findOne).toHaveBeenCalledWith({ where: { id: 'node-1' }, relations: ['zone'] });
    });
  });

  describe('create', () => {
    it('crea el nodo forzando provisioningMode=MANUAL y lastSyncStatus=NEVER, con el puerto REST por defecto (443, no el de la API binaria)', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);

      const result = await service.create({ name: 'Nuevo Nodo' });

      expect(result.provisioningMode).toBe('MANUAL');
      expect(result.lastSyncStatus).toBe('NEVER');
      expect(result.isActive).toBe(true);
      expect(result.apiPort).toBe(443);
      expect(result.useHttps).toBe(true);
    });

    it('respeta el apiPort explícito', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);

      const result = await service.create({ name: 'Nuevo Nodo', apiPort: 8729 });

      expect(result.apiPort).toBe(8729);
    });

    it('lanza ConflictException si ya existe un nodo con el mismo nombre', async () => {
      nodeRepo.findOneBy.mockResolvedValue(makeNode());

      await expect(service.create({ name: 'RB Las Yayas' })).rejects.toThrow(ConflictException);
      expect(nodeRepo.save).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si se referencia una zona inexistente', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);
      zoneRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create({ name: 'Nuevo Nodo', zoneId: 'zone-x' })).rejects.toThrow(NotFoundException);
      expect(nodeRepo.save).not.toHaveBeenCalled();
    });

    it('crea el nodo cuando la zona referenciada sí existe', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);
      zoneRepo.findOneBy.mockResolvedValue(makeZone());

      const result = await service.create({ name: 'Nuevo Nodo', zoneId: 'zone-1' });

      expect(result.zoneId).toBe('zone-1');
      expect(nodeRepo.save).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('lanza NotFoundException si el nodo no existe', async () => {
      nodeRepo.findOne.mockResolvedValue(null);

      await expect(service.update('node-x', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('mergea únicamente los campos provistos', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode());

      const result = await service.update('node-1', { model: 'RB5009UG+S+' });

      expect(result.model).toBe('RB5009UG+S+');
      expect(result.name).toBe('RB Las Yayas');
    });

    it('lanza ConflictException si el nuevo nombre ya está en uso por otro nodo', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1', name: 'RB Las Yayas' }));
      nodeRepo.findOneBy.mockResolvedValue(makeNode({ id: 'node-2', name: 'RB Otro Cerro' }));

      await expect(service.update('node-1', { name: 'RB Otro Cerro' })).rejects.toThrow(ConflictException);
    });

    it('lanza NotFoundException si se reasigna a una zona inexistente', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ zoneId: undefined }));
      zoneRepo.findOneBy.mockResolvedValue(null);

      await expect(service.update('node-1', { zoneId: 'zone-x' })).rejects.toThrow(NotFoundException);
    });

    it('permite activar RouterOS explícitamente vía provisioningMode', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ provisioningMode: 'MANUAL' }));

      const result = await service.update('node-1', { provisioningMode: 'ROUTEROS' });

      expect(result.provisioningMode).toBe('ROUTEROS');
    });
  });

  describe('deactivate', () => {
    it('es idempotente: desactivar un nodo ya inactivo no vuelve a guardar', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ isActive: false }));

      const result = await service.deactivate('node-1');

      expect(result.isActive).toBe(false);
      expect(nodeRepo.save).not.toHaveBeenCalled();
    });

    it('pone isActive=false en un nodo activo', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ isActive: true }));

      const result = await service.deactivate('node-1');

      expect(result.isActive).toBe(false);
      expect(nodeRepo.save).toHaveBeenCalled();
    });
  });

  describe('reactivate', () => {
    it('pone isActive=true en un nodo inactivo', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ isActive: false }));

      const result = await service.reactivate('node-1');

      expect(result.isActive).toBe(true);
      expect(nodeRepo.save).toHaveBeenCalled();
    });

    it('es idempotente: reactivar un nodo ya activo no vuelve a guardar', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ isActive: true }));

      const result = await service.reactivate('node-1');

      expect(result.isActive).toBe(true);
      expect(nodeRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('elimina el nodo suavemente si no tiene accesos asignados', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1', isActive: true }));
      const result = await service.delete('node-1');

      expect(result.success).toBe(true);
      expect(nodeRepo.save).toHaveBeenCalled();
    });

    it('limpia el registro de portal cautivo del nodo eliminado', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1', isActive: true }));
      portalRegistryRepo.findOneBy.mockResolvedValue({ id: 'reg-1', nodeId: 'node-1', publicIp: '190.0.0.1' });

      await service.delete('node-1');

      expect(portalRegistryRepo.findOneBy).toHaveBeenCalledWith({ nodeId: 'node-1' });
      expect(portalRegistryRepo.remove).toHaveBeenCalledWith({ id: 'reg-1', nodeId: 'node-1', publicIp: '190.0.0.1' });
    });
  });

  describe('sincronización con platform.node_portal_registry', () => {
    it('create con publicIp crea una fila nueva en el registro central', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);
      portalRegistryRepo.findOneBy.mockResolvedValue(null);

      const result = await service.create({ name: 'Nuevo Nodo', publicIp: '190.0.0.5' });

      expect(portalRegistryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', nodeId: result.id, publicIp: '190.0.0.5' }),
      );
    });

    it('create sin publicIp no toca el registro', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);

      await service.create({ name: 'Nuevo Nodo' });

      expect(portalRegistryRepo.save).not.toHaveBeenCalled();
      // Igual intenta limpiar por si acaso (no-op porque findOneBy devuelve null).
      expect(portalRegistryRepo.findOneBy).toHaveBeenCalledWith({ nodeId: expect.any(String) });
    });

    it('update que agrega publicIp a un nodo que no tenía fila crea una nueva', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1' }));
      nodeRepo.findOneBy.mockResolvedValue(null);
      portalRegistryRepo.findOneBy.mockResolvedValue(null);

      await service.update('node-1', { publicIp: '190.0.0.9' });

      expect(portalRegistryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', nodeId: 'node-1', publicIp: '190.0.0.9' }),
      );
    });

    it('update que cambia publicIp actualiza la fila existente del mismo nodo en vez de duplicarla', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1' }));
      nodeRepo.findOneBy.mockResolvedValue(null);
      const existing = { id: 'reg-1', nodeId: 'node-1', publicIp: '190.0.0.1', tenantId: 'tenant-1' };
      portalRegistryRepo.findOneBy.mockImplementation(({ publicIp, nodeId }: any) => {
        if (nodeId === 'node-1') return Promise.resolve(existing);
        return Promise.resolve(null);
      });

      await service.update('node-1', { publicIp: '190.0.0.99' });

      expect(portalRegistryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'reg-1', nodeId: 'node-1', publicIp: '190.0.0.99' }),
      );
      expect(portalRegistryRepo.create).not.toHaveBeenCalled();
    });

    it('update que limpia publicIp (string vacío) borra la fila del registro', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1' }));
      nodeRepo.findOneBy.mockResolvedValue(null);
      const existing = { id: 'reg-1', nodeId: 'node-1', publicIp: '190.0.0.1' };
      portalRegistryRepo.findOneBy.mockResolvedValue(existing);

      await service.update('node-1', { publicIp: '' });

      expect(portalRegistryRepo.remove).toHaveBeenCalledWith(existing);
      expect(portalRegistryRepo.save).not.toHaveBeenCalled();
    });

    it('si la IP pública ya estaba asignada a OTRO nodo, se la reasigna (borra la vieja y crea la nueva)', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-2' }));
      nodeRepo.findOneBy.mockResolvedValue(null);
      const conflicting = { id: 'reg-old', nodeId: 'node-1', publicIp: '190.0.0.1' };
      portalRegistryRepo.findOneBy.mockImplementation(({ publicIp, nodeId }: any) => {
        if (publicIp === '190.0.0.1' && nodeId === undefined) return Promise.resolve(conflicting);
        if (nodeId === 'node-2') return Promise.resolve(null);
        return Promise.resolve(null);
      });

      await service.update('node-2', { publicIp: '190.0.0.1' });

      expect(portalRegistryRepo.remove).toHaveBeenCalledWith(conflicting);
      expect(portalRegistryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', nodeId: 'node-2', publicIp: '190.0.0.1' }),
      );
    });

    it('un fallo al sincronizar el registro no revienta el guardado del nodo (best-effort)', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);
      portalRegistryRepo.findOneBy.mockRejectedValue(new Error('DB de plataforma caída'));

      await expect(service.create({ name: 'Nuevo Nodo', publicIp: '190.0.0.5' })).resolves.toBeDefined();
    });
  });

  describe('testConnection', () => {
    it('invoca el servicio de pruebas pre-flight correctamente', async () => {
      const result = await service.testConnection({ host: '192.168.88.1' });
      expect(result.success).toBe(true);
      expect(result.latencyMs).toBe(12);
    });
  });

  describe('getWireguardScript', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = {
        ...originalEnv,
        WIREGUARD_SERVER_ENDPOINT: 'vpn.sumtech.com.do',
        WIREGUARD_SERVER_PUBLIC_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('genera el script si el nodo tiene método wireguard', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1', connectionMethod: 'wireguard', wireguardIp: '10.254.1.2' }));
      const result = await service.getWireguardScript('node-1');
      expect(result.routerosScript).toBeDefined();
    });

    it('rechaza si el hub central no está configurado', async () => {
      process.env = { ...originalEnv, WIREGUARD_SERVER_ENDPOINT: '', WIREGUARD_SERVER_PUBLIC_KEY: '' };
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1', connectionMethod: 'wireguard', wireguardIp: '10.254.1.2' }));
      await expect(service.getWireguardScript('node-1')).rejects.toThrow();
    });

    it('genera y persiste un par de llaves si el nodo aún no tiene una', async () => {
      const node = makeNode({ id: 'node-1', connectionMethod: 'wireguard', wireguardIp: '10.254.1.2' });
      nodeRepo.findOne.mockResolvedValue(node);
      await service.getWireguardScript('node-1');
      expect(nodeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ wireguardPublicKey: 'test-public-key' }),
      );
    });

    it('marca hubRegistered:false y guarda el peer como PENDING_MANUAL si el agente no responde', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1', connectionMethod: 'wireguard', wireguardIp: '10.254.1.2' }));
      const result = await service.getWireguardScript('node-1');
      expect(result.hubRegistered).toBe(false);
      expect(wireguardPeerRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PENDING_MANUAL' }),
        { conflictPaths: ['nodeId'] },
      );
    });

    it('marca hubRegistered:true y guarda el peer como REGISTERED si el agente confirma el alta', async () => {
      wireGuardHubClient.registerPeer.mockResolvedValue({ success: true });
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1', connectionMethod: 'wireguard', wireguardIp: '10.254.1.2' }));
      const result = await service.getWireguardScript('node-1');
      expect(result.hubRegistered).toBe(true);
      expect(wireguardPeerRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'REGISTERED' }),
        { conflictPaths: ['nodeId'] },
      );
    });
  });

  describe('verifyWireguardPeer', () => {
    it('lanza si el nodo no tiene clave pública WireGuard', async () => {
      nodeRepo.findOne.mockResolvedValue(makeNode({ id: 'node-1', connectionMethod: 'wireguard' }));
      await expect(service.verifyWireguardPeer('node-1')).rejects.toThrow();
    });

    it('lanza si el nodo aún no generó su peer en la BD', async () => {
      nodeRepo.findOne.mockResolvedValue(
        makeNode({ id: 'node-1', connectionMethod: 'wireguard', wireguardPublicKey: 'pub-key' }),
      );
      wireguardPeerRepo.findOneBy.mockResolvedValue(null);
      await expect(service.verifyWireguardPeer('node-1')).rejects.toThrow(NotFoundException);
    });

    it('marca connected:true si el handshake es reciente', async () => {
      nodeRepo.findOne.mockResolvedValue(
        makeNode({ id: 'node-1', connectionMethod: 'wireguard', wireguardPublicKey: 'pub-key' }),
      );
      wireguardPeerRepo.findOneBy.mockResolvedValue({ nodeId: 'node-1', status: 'REGISTERED' });
      wireGuardHubClient.getPeerStatus.mockResolvedValue({
        publicKey: 'pub-key',
        lastHandshakeAt: new Date().toISOString(),
      });

      const result = await service.verifyWireguardPeer('node-1');
      expect(result.connected).toBe(true);
      expect(wireguardPeerRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'CONNECTED' }));
    });

    it('marca connected:false si el handshake es viejo (>180s)', async () => {
      nodeRepo.findOne.mockResolvedValue(
        makeNode({ id: 'node-1', connectionMethod: 'wireguard', wireguardPublicKey: 'pub-key' }),
      );
      wireguardPeerRepo.findOneBy.mockResolvedValue({ nodeId: 'node-1', status: 'CONNECTED' });
      wireGuardHubClient.getPeerStatus.mockResolvedValue({
        publicKey: 'pub-key',
        lastHandshakeAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      });

      const result = await service.verifyWireguardPeer('node-1');
      expect(result.connected).toBe(false);
      expect(wireguardPeerRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'DISCONNECTED' }));
    });

    it('devuelve connected:false sin tocar la BD si el agente no responde', async () => {
      nodeRepo.findOne.mockResolvedValue(
        makeNode({ id: 'node-1', connectionMethod: 'wireguard', wireguardPublicKey: 'pub-key' }),
      );
      wireguardPeerRepo.findOneBy.mockResolvedValue({ nodeId: 'node-1', status: 'REGISTERED' });
      wireGuardHubClient.getPeerStatus.mockResolvedValue(null);

      const result = await service.verifyWireguardPeer('node-1');
      expect(result.connected).toBe(false);
      expect(wireguardPeerRepo.save).not.toHaveBeenCalled();
    });
  });
});
