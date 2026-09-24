import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ServiceFeesService } from './service-fees.service';
import { ServiceFeeEntity } from './entities/service-fee.entity';

describe('ServiceFeesService', () => {
  let service: ServiceFeesService;
  let feeRepo: any;
  let queryBuilder: any;

  const makeFee = (overrides: Partial<ServiceFeeEntity> = {}): ServiceFeeEntity =>
    ({
      id: 'fee-1',
      name: 'Cargo de Instalación Fibra GPON Residencial',
      feeType: 'INSTALLATION_FEE',
      price: 1500,
      itbisRate: 0.18,
      isActive: true,
      ...overrides,
    }) as ServiceFeeEntity;

  beforeEach(async () => {
    queryBuilder = {
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[makeFee()], 1]),
    };

    feeRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOneBy: jest.fn(),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id || 'fee-generated', ...entity })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ServiceFeesService, { provide: getRepositoryToken(ServiceFeeEntity), useValue: feeRepo }],
    }).compile();

    service = module.get<ServiceFeesService>(ServiceFeesService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('aplica paginación por defecto (page 1, limit 20) y devuelve la forma paginada estándar', async () => {
      const result = await service.findAll();

      expect(result).toEqual({ data: [makeFee()], total: 1, page: 1, limit: 20, totalPages: 1 });
      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(20);
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('fee.name', 'ASC');
    });

    it('respeta page/limit provistos', async () => {
      await service.findAll({ page: 3, limit: 5 });

      expect(queryBuilder.skip).toHaveBeenCalledWith(10);
      expect(queryBuilder.take).toHaveBeenCalledWith(5);
    });

    it('filtra por isActive cuando activeOnly=true', async () => {
      await service.findAll({}, true);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('fee.isActive = :active', { active: true });
    });

    it('no filtra por isActive cuando activeOnly=false (default)', async () => {
      await service.findAll({});

      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith('fee.isActive = :active', expect.anything());
    });

    it('filtra por nombre cuando se provee search', async () => {
      await service.findAll({ search: 'Instalación' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('fee.name ILIKE :search', { search: '%Instalación%' });
    });

    it('no aplica filtro de search cuando no se provee', async () => {
      await service.findAll({});

      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('ILIKE'), expect.anything());
    });
  });

  describe('findById', () => {
    it('lanza NotFoundException si el cargo no existe', async () => {
      feeRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findById('fee-x')).rejects.toThrow(NotFoundException);
    });

    it('devuelve el cargo encontrado (incluye inactivos, sin filtrar isActive)', async () => {
      feeRepo.findOneBy.mockResolvedValue(makeFee({ isActive: false }));

      const result = await service.findById('fee-1');
      expect(result.isActive).toBe(false);
    });
  });

  describe('create', () => {
    it('crea el cargo forzando isActive=true y aplicando default de itbisRate cuando no se provee', async () => {
      const result = await service.create({
        name: 'Cargo de Reconexión',
        feeType: 'REPAIR_FEE',
        price: 500,
      } as any);

      expect(result.isActive).toBe(true);
      expect(result.itbisRate).toBe(0.18);
    });

    it('respeta itbisRate explícito al crear', async () => {
      const result = await service.create({
        name: 'Cargo de Reconexión',
        feeType: 'REPAIR_FEE',
        price: 500,
        itbisRate: 0,
      } as any);

      expect(result.itbisRate).toBe(0);
    });
  });

  describe('update', () => {
    it('lanza NotFoundException si el cargo no existe', async () => {
      feeRepo.findOneBy.mockResolvedValue(null);

      await expect(service.update('fee-x', { name: 'X' } as any)).rejects.toThrow(NotFoundException);
    });

    it('mergea únicamente los campos provistos', async () => {
      feeRepo.findOneBy.mockResolvedValue(makeFee());

      const result = await service.update('fee-1', { price: 1800 } as any);

      expect(result.price).toBe(1800);
      expect(result.name).toBe('Cargo de Instalación Fibra GPON Residencial');
    });
  });

  describe('deactivate', () => {
    it('lanza NotFoundException si el cargo no existe', async () => {
      feeRepo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate('fee-x')).rejects.toThrow(NotFoundException);
    });

    it('pone isActive=false en un cargo activo', async () => {
      feeRepo.findOneBy.mockResolvedValue(makeFee({ isActive: true }));

      const result = await service.deactivate('fee-1');

      expect(result.isActive).toBe(false);
      expect(feeRepo.save).toHaveBeenCalled();
    });

    it('es idempotente: desactivar un cargo ya inactivo no falla y no vuelve a guardar', async () => {
      feeRepo.findOneBy.mockResolvedValue(makeFee({ isActive: false }));

      const result = await service.deactivate('fee-1');

      expect(result.isActive).toBe(false);
      expect(feeRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('reactivate', () => {
    it('pone isActive=true en un cargo inactivo', async () => {
      feeRepo.findOneBy.mockResolvedValue(makeFee({ isActive: false }));

      const result = await service.reactivate('fee-1');

      expect(result.isActive).toBe(true);
      expect(feeRepo.save).toHaveBeenCalled();
    });

    it('es idempotente: reactivar un cargo ya activo no falla y no vuelve a guardar', async () => {
      feeRepo.findOneBy.mockResolvedValue(makeFee({ isActive: true }));

      const result = await service.reactivate('fee-1');

      expect(result.isActive).toBe(true);
      expect(feeRepo.save).not.toHaveBeenCalled();
    });
  });
});
