import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { NetworkNodesService } from './network-nodes.service';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { ZoneEntity } from './entities/zone.entity';

describe('NetworkNodesService', () => {
  let service: NetworkNodesService;
  let nodeRepo: any;
  let zoneRepo: any;
  let queryBuilder: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworkNodesService,
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(ZoneEntity), useValue: zoneRepo },
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

    it('filtra por nombre cuando se provee search', async () => {
      await service.findAll({ search: 'Yayas' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('node.name ILIKE :search', { search: '%Yayas%' });
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
});
