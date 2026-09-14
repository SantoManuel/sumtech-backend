import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ZonesService } from './zones.service';
import { ZoneEntity } from './entities/zone.entity';

describe('ZonesService', () => {
  let service: ZonesService;
  let zoneRepo: any;
  let queryBuilder: any;

  const makeZone = (overrides: Partial<ZoneEntity> = {}): ZoneEntity =>
    ({
      id: 'zone-1',
      name: 'RB Las Yayas',
      description: undefined,
      isActive: true,
      ...overrides,
    }) as ZoneEntity;

  beforeEach(async () => {
    queryBuilder = {
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[makeZone()], 1]),
    };

    zoneRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOneBy: jest.fn(),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id || 'zone-generated', ...entity })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ZonesService, { provide: getRepositoryToken(ZoneEntity), useValue: zoneRepo }],
    }).compile();

    service = module.get<ZonesService>(ZonesService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('aplica paginación por defecto (page 1, limit 20) y devuelve la forma paginada estándar', async () => {
      const result = await service.findAll();

      expect(result).toEqual({ data: [makeZone()], total: 1, page: 1, limit: 20, totalPages: 1 });
      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(20);
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('zone.name', 'ASC');
    });

    it('respeta page/limit provistos', async () => {
      await service.findAll({ page: 3, limit: 5 });

      expect(queryBuilder.skip).toHaveBeenCalledWith(10);
      expect(queryBuilder.take).toHaveBeenCalledWith(5);
    });

    it('filtra por isActive cuando activeOnly=true', async () => {
      await service.findAll({}, true);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('zone.isActive = :active', { active: true });
    });

    it('no filtra por isActive cuando activeOnly=false (default)', async () => {
      await service.findAll({});

      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith('zone.isActive = :active', expect.anything());
    });

    it('filtra por nombre cuando se provee search', async () => {
      await service.findAll({ search: 'Yayas' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('zone.name ILIKE :search', { search: '%Yayas%' });
    });

    it('no aplica filtro de search cuando no se provee', async () => {
      await service.findAll({});

      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('ILIKE'), expect.anything());
    });
  });

  describe('findById', () => {
    it('lanza NotFoundException si la zona no existe', async () => {
      zoneRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findById('zone-x')).rejects.toThrow(NotFoundException);
    });

    it('devuelve la zona encontrada', async () => {
      zoneRepo.findOneBy.mockResolvedValue(makeZone());

      const result = await service.findById('zone-1');
      expect(result.name).toBe('RB Las Yayas');
    });
  });

  describe('create', () => {
    it('crea la zona forzando isActive=true', async () => {
      zoneRepo.findOneBy.mockResolvedValue(null);

      const result = await service.create({ name: 'Nueva Zona' });

      expect(result.isActive).toBe(true);
      expect(zoneRepo.save).toHaveBeenCalled();
    });

    it('lanza ConflictException si ya existe una zona con el mismo nombre', async () => {
      zoneRepo.findOneBy.mockResolvedValue(makeZone({ name: 'RB Las Yayas' }));

      await expect(service.create({ name: 'RB Las Yayas' })).rejects.toThrow(ConflictException);
      expect(zoneRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('lanza NotFoundException si la zona no existe', async () => {
      zoneRepo.findOneBy.mockResolvedValue(null);

      await expect(service.update('zone-x', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('mergea únicamente los campos provistos', async () => {
      zoneRepo.findOneBy.mockResolvedValue(makeZone());

      const result = await service.update('zone-1', { description: 'Torre nueva' });

      expect(result.description).toBe('Torre nueva');
      expect(result.name).toBe('RB Las Yayas');
    });

    it('no valida unicidad de nombre si el nombre no cambia', async () => {
      zoneRepo.findOneBy.mockResolvedValueOnce(makeZone());

      await service.update('zone-1', { name: 'RB Las Yayas', description: 'Actualizada' });

      // Solo la llamada de findById() consultó el repositorio; no hubo una
      // segunda consulta de unicidad porque el nombre no cambió.
      expect(zoneRepo.findOneBy).toHaveBeenCalledTimes(1);
    });

    it('lanza ConflictException si el nuevo nombre ya está en uso por otra zona', async () => {
      zoneRepo.findOneBy
        .mockResolvedValueOnce(makeZone({ id: 'zone-1', name: 'RB Las Yayas' }))
        .mockResolvedValueOnce(makeZone({ id: 'zone-2', name: 'RB Otro Cerro' }));

      await expect(service.update('zone-1', { name: 'RB Otro Cerro' })).rejects.toThrow(ConflictException);
    });
  });

  describe('deactivate', () => {
    it('lanza NotFoundException si la zona no existe', async () => {
      zoneRepo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate('zone-x')).rejects.toThrow(NotFoundException);
    });

    it('pone isActive=false en una zona activa', async () => {
      zoneRepo.findOneBy.mockResolvedValue(makeZone({ isActive: true }));

      const result = await service.deactivate('zone-1');

      expect(result.isActive).toBe(false);
      expect(zoneRepo.save).toHaveBeenCalled();
    });

    it('es idempotente: desactivar una zona ya inactiva no falla y no vuelve a guardar', async () => {
      zoneRepo.findOneBy.mockResolvedValue(makeZone({ isActive: false }));

      const result = await service.deactivate('zone-1');

      expect(result.isActive).toBe(false);
      expect(zoneRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('reactivate', () => {
    it('pone isActive=true en una zona inactiva', async () => {
      zoneRepo.findOneBy.mockResolvedValue(makeZone({ isActive: false }));

      const result = await service.reactivate('zone-1');

      expect(result.isActive).toBe(true);
      expect(zoneRepo.save).toHaveBeenCalled();
    });

    it('es idempotente: reactivar una zona ya activa no falla y no vuelve a guardar', async () => {
      zoneRepo.findOneBy.mockResolvedValue(makeZone({ isActive: true }));

      const result = await service.reactivate('zone-1');

      expect(result.isActive).toBe(true);
      expect(zoneRepo.save).not.toHaveBeenCalled();
    });
  });
});
