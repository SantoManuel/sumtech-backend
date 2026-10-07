import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { UnknownOltVendorError } from '../ports/olt-driver.port';
import { OltManagementService } from './olt-management.service';
import { OltEntity } from '../entities/olt.entity';
import { OltRolePermissionEntity } from '../entities/olt-role-permission.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';

describe('OltManagementService', () => {
  let service: OltManagementService;
  let oltRepo: any;
  let permRepo: any;
  let ifaceRepo: any;
  let nodeRepo: any;
  let zteDriver: any;
  let driverRegistry: any;
  let reachabilityResolver: any;
  let deviceOperationLogger: any;

  const mockOlt = {
    id: 'olt-1',
    name: 'OLT Los Toros',
    vendor: 'ZTE',
    model: 'C320',
    host: '192.168.100.100',
    port: 23,
    username: 'smartoltuser',
    passwordEnc: 'mock-enc-pass',
    connectionMethod: 'VIA_MIKROTIK',
    viaNodeId: 'node-1',
    natPort: 2323,
    status: 'ACTIVO',
    connectionStatus: 'DESCONECTADO',
  } as unknown as OltEntity;

  const mockNode = {
    id: 'node-1',
    name: 'RB Core',
    managementIp: '10.0.0.1',
    apiPort: 8729,
  } as NetworkNodeEntity;

  beforeEach(async () => {
    oltRepo = {
      find: jest.fn().mockResolvedValue([mockOlt]),
      findOne: jest.fn().mockResolvedValue(mockOlt),
      findOneBy: jest.fn().mockResolvedValue(mockOlt),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve({ id: 'olt-1', ...dto })),
    };
    permRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve(dto)),
    };
    ifaceRepo = {
      findOneBy: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve(dto)),
    };
    nodeRepo = {
      findOneBy: jest.fn().mockResolvedValue(mockNode),
    };
    zteDriver = {
      testConnection: jest.fn().mockResolvedValue({ ok: true, latencyMs: 45 }),
      getSystemInfo: jest.fn().mockResolvedValue({ uptime: '15d 4h', firmwareVersion: 'V1.2.5P3' }),
      discoverInterfaces: jest.fn().mockResolvedValue([
        { name: 'gpon-olt_1/1/1', type: 'PON', slot: 1, port: 1, adminState: 'UP', operState: 'UP' },
      ]),
      getCapabilities: jest.fn().mockReturnValue({
        testConnection: true,
        systemInfo: true,
        discoverInterfaces: true,
        configureVlan: true,
        onuDiscovery: true,
        onuOpticalPower: true,
        onuAuthorize: true,
        onuAdminState: true,
        onuDelete: true,
      }),
      constructor: { name: 'ZteC320Driver' },
    };
    driverRegistry = {
      resolve: jest.fn().mockReturnValue(zteDriver),
    };
    reachabilityResolver = {
      resolveEndpoint: jest.fn().mockResolvedValue({ host: '10.0.0.1', port: 8729, useHttps: false }),
    };
    deviceOperationLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OltManagementService,
        { provide: getRepositoryToken(OltEntity), useValue: oltRepo },
        { provide: getRepositoryToken(OltRolePermissionEntity), useValue: permRepo },
        { provide: getRepositoryToken(OltInterfaceEntity), useValue: ifaceRepo },
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: OltDriverRegistry, useValue: driverRegistry },
        { provide: ReachabilityResolver, useValue: reachabilityResolver },
        { provide: DeviceOperationLogger, useValue: deviceOperationLogger },
      ],
    }).compile();

    service = module.get<OltManagementService>(OltManagementService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('testConnection', () => {
    it('resuelve conexión VIA_MIKROTIK y actualiza el estado a CONECTADO', async () => {
      const res = await service.testConnection('olt-1');

      expect(res.ok).toBe(true);
      expect(res.status).toBe('CONECTADO');
      expect(res.latencyMs).toBe(45);
      expect(zteDriver.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '10.0.0.1',
          port: 2323,
        }),
      );
    });

    it('actualiza el estado a INALCANZABLE si el driver falla', async () => {
      zteDriver.testConnection.mockResolvedValue({ ok: false, error: 'Connection refused' });

      const res = await service.testConnection('olt-1');

      expect(res.ok).toBe(false);
      expect(res.status).toBe('INALCANZABLE');
      expect(oltRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionStatus: 'INALCANZABLE',
        }),
      );
    });
  });

  describe('discoverInterfaces (RF-OLT-012)', () => {
    it('ejecuta escaneo y guarda interfaces PON descubiertas', async () => {
      ifaceRepo.find.mockResolvedValue([
        { name: 'gpon-olt_1/1/1', type: 'PON', slot: 1, port: 1 },
      ]);

      const ifaces = await service.discoverInterfaces('olt-1', 'admin-id');

      expect(ifaces).toHaveLength(1);
      expect(zteDriver.discoverInterfaces).toHaveBeenCalled();
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'COMMAND',
          status: 'SUCCESS',
        }),
      );
    });
  });

  describe('enrutamiento por fabricante', () => {
    it('findById adjunta las capacidades reales del driver resuelto para el vendor', async () => {
      const olt = await service.findById('olt-1');

      expect(driverRegistry.resolve).toHaveBeenCalledWith('ZTE');
      expect((olt as any).capabilities).toEqual(
        expect.objectContaining({ testConnection: true, onuAuthorize: true }),
      );
    });

    it('nunca ejecuta testConnection del driver si el vendor no es reconocido', async () => {
      driverRegistry.resolve.mockImplementation(() => {
        throw new UnknownOltVendorError('MARCA-DESCONOCIDA');
      });

      await expect(service.testConnection('olt-1')).rejects.toThrow(BadRequestException);
      expect(zteDriver.testConnection).not.toHaveBeenCalled();
    });
  });
});
