import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { UnknownOltVendorError } from '../ports/olt-driver.port';
import { OltManagementService } from './olt-management.service';
import { OltEntity } from '../entities/olt.entity';
import { OltRolePermissionEntity } from '../entities/olt-role-permission.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { OnuEntity } from '../entities/onu.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { OltConnectionResolverService } from './olt-connection-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';

describe('OltManagementService', () => {
  let service: OltManagementService;
  let oltRepo: any;
  let permRepo: any;
  let ifaceRepo: any;
  let onuRepo: any;
  let zteDriver: any;
  let driverRegistry: any;
  let connectionResolver: any;
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

  /** Query builder encadenable: resuelve getManyAndCount/getMany con los valores dados, registra los where/andWhere aplicados. */
  const makeQueryBuilder = (manyAndCountResult: [any[], number], manyResult: any[]) => {
    const calls: { andWhere: any[]; orderBy: any[] } = { andWhere: [], orderBy: [] };
    const qb: any = {
      select: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn((...args: any[]) => { calls.andWhere.push(args); return qb; }),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      orderBy: jest.fn((...args: any[]) => { calls.orderBy.push(args); return qb; }),
      getManyAndCount: jest.fn().mockResolvedValue(manyAndCountResult),
      getMany: jest.fn().mockResolvedValue(manyResult),
      __calls: calls,
    };
    return qb;
  };

  beforeEach(async () => {
    oltRepo = {
      find: jest.fn().mockResolvedValue([mockOlt]),
      findOne: jest.fn().mockResolvedValue(mockOlt),
      findOneBy: jest.fn().mockResolvedValue(mockOlt),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve({ id: 'olt-1', ...dto })),
      createQueryBuilder: jest.fn(),
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
    onuRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
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
      getCapabilityNotes: jest.fn().mockReturnValue({}),
      constructor: { name: 'ZteC320Driver' },
    };
    driverRegistry = {
      resolve: jest.fn().mockReturnValue(zteDriver),
    };
    connectionResolver = {
      resolve: jest.fn().mockResolvedValue({
        host: '10.0.0.1',
        port: 2323,
        username: 'smartoltuser',
        password: 'decrypted-pass',
      }),
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
        { provide: getRepositoryToken(OnuEntity), useValue: onuRepo },
        { provide: OltDriverRegistry, useValue: driverRegistry },
        { provide: OltConnectionResolverService, useValue: connectionResolver },
        { provide: DeviceOperationLogger, useValue: deviceOperationLogger },
      ],
    }).compile();

    service = module.get<OltManagementService>(OltManagementService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('findAll (paginación)', () => {
    it('devuelve el contrato paginado {data,total,page,limit,totalPages} con los valores por defecto (page=1, limit=20)', async () => {
      const idQb = makeQueryBuilder([[{ id: 'olt-1' }], 1], []);
      const detailQb = makeQueryBuilder([[], 0], [mockOlt]);
      oltRepo.createQueryBuilder.mockReturnValueOnce(idQb).mockReturnValueOnce(detailQb);

      const result = await service.findAll();

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.data).toHaveLength(1);
      expect((result.data[0] as any).capabilities).toBeDefined();
    });

    it('aplica skip/take según page y limit explícitos', async () => {
      const idQb = makeQueryBuilder([[{ id: 'olt-2' }], 25], []);
      const detailQb = makeQueryBuilder([[], 0], [mockOlt]);
      oltRepo.createQueryBuilder.mockReturnValueOnce(idQb).mockReturnValueOnce(detailQb);

      const result = await service.findAll({ page: 2, limit: 10 } as any);

      expect(idQb.skip).toHaveBeenCalledWith(10);
      expect(idQb.take).toHaveBeenCalledWith(10);
      expect(result.totalPages).toBe(3);
    });

    it('filtra por activeOnly, vendor y search', async () => {
      const idQb = makeQueryBuilder([[{ id: 'olt-1' }], 1], []);
      const detailQb = makeQueryBuilder([[], 0], [mockOlt]);
      oltRepo.createQueryBuilder.mockReturnValueOnce(idQb).mockReturnValueOnce(detailQb);

      await service.findAll({ activeOnly: true, vendor: 'ZTE', search: 'Toros' } as any);

      expect(idQb.andWhere).toHaveBeenCalledWith('olt.isActive = :active', { active: true });
      expect(idQb.andWhere).toHaveBeenCalledWith('olt.vendor = :vendor', { vendor: 'ZTE' });
      expect(idQb.andWhere).toHaveBeenCalledWith(
        '(olt.name ILIKE :search OR olt.host ILIKE :search OR olt.model ILIKE :search)',
        { search: '%Toros%' },
      );
    });

    it('filtra por connectionStatus', async () => {
      const idQb = makeQueryBuilder([[{ id: 'olt-1' }], 1], []);
      const detailQb = makeQueryBuilder([[], 0], [mockOlt]);
      oltRepo.createQueryBuilder.mockReturnValueOnce(idQb).mockReturnValueOnce(detailQb);

      await service.findAll({ connectionStatus: 'CONECTADO' } as any);

      expect(idQb.andWhere).toHaveBeenCalledWith('olt.connectionStatus = :connectionStatus', { connectionStatus: 'CONECTADO' });
    });

    it('no ejecuta la segunda consulta (detalle) si no hay resultados en la página', async () => {
      const idQb = makeQueryBuilder([[], 0], []);
      oltRepo.createQueryBuilder.mockReturnValueOnce(idQb);

      const result = await service.findAll({ page: 5, limit: 10 } as any);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(oltRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('no multiplica OLTs por sus relaciones OneToMany (interfaces/rolePermissions) al paginar', async () => {
      // La query de IDs nunca hace join con interfaces/rolePermissions -- por diseño,
      // para que el LIMIT real pagine OLTs, no filas del producto cartesiano del join.
      const idQb = makeQueryBuilder([[{ id: 'olt-1' }], 1], []);
      const detailQb = makeQueryBuilder([[], 0], [mockOlt]);
      oltRepo.createQueryBuilder.mockReturnValueOnce(idQb).mockReturnValueOnce(detailQb);

      await service.findAll({ page: 1, limit: 1 } as any);

      expect(idQb.leftJoinAndSelect).not.toHaveBeenCalled();
      expect(detailQb.leftJoinAndSelect).toHaveBeenCalledWith('olt.rolePermissions', 'rolePermissions');
      expect(detailQb.leftJoinAndSelect).toHaveBeenCalledWith('olt.interfaces', 'interfaces');
    });
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

  describe('registeredOnus (conteo real desde net.onus)', () => {
    it('findById adjunta el conteo real de ONUs ACTIVE por interfaz, no el reportado por el driver', async () => {
      const olt = {
        ...mockOlt,
        interfaces: [
          { id: 'iface-epon-1-1' },
          { id: 'iface-epon-1-2' },
        ],
      } as unknown as OltEntity;
      oltRepo.findOne.mockResolvedValue(olt);
      onuRepo.createQueryBuilder().getRawMany.mockResolvedValue([
        { ponInterfaceId: 'iface-epon-1-1', count: '2' },
      ]);

      const result = await service.findById('olt-1');

      expect((result.interfaces![0] as any).registeredOnus).toBe(2);
      expect((result.interfaces![1] as any).registeredOnus).toBe(0);
    });

    it('filtra por status = ACTIVE y no cuenta ONUs UNCONFIGURED/OFFLINE', async () => {
      const olt = { ...mockOlt, interfaces: [{ id: 'iface-1' }] } as unknown as OltEntity;
      oltRepo.findOne.mockResolvedValue(olt);
      const qb = onuRepo.createQueryBuilder();

      await service.findById('olt-1');

      expect(qb.andWhere).toHaveBeenCalledWith('onu.status = :status', { status: 'ACTIVE' });
    });

    it('no consulta net.onus si la OLT no tiene interfaces cargadas', async () => {
      const olt = { ...mockOlt, interfaces: [] } as unknown as OltEntity;
      oltRepo.findOne.mockResolvedValue(olt);

      await service.findById('olt-1');

      expect(onuRepo.createQueryBuilder).not.toHaveBeenCalled();
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

    it('findById adjunta capabilityNotes del driver (motivo real de un "false", ej. sin chasis modular)', async () => {
      zteDriver.getCapabilityNotes.mockReturnValue({ chassisCards: 'Sin chasis modular en este hardware.' });

      const olt = await service.findById('olt-1');

      expect((olt as any).capabilityNotes).toEqual({ chassisCards: 'Sin chasis modular en este hardware.' });
    });

    it('capabilityNotes queda vacío si el vendor no es reconocido (mismo fallback que capabilities)', async () => {
      driverRegistry.resolve.mockImplementation(() => {
        throw new UnknownOltVendorError('MARCA-DESCONOCIDA');
      });

      const olt = await service.findById('olt-1');

      expect((olt as any).capabilityNotes).toEqual({});
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
