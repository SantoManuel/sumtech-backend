import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConsumableStockService } from './consumable-stock.service';
import { ProductEntity } from '../entities/product.entity';
import { StockItemEntity } from '../entities/stock-item.entity';
import { StockMovementEntity } from '../entities/stock-movement.entity';

function createStockQueryBuilder(product: { stockCurrent: number }) {
  let delta = 0;
  let hasGuard = false;
  let required = 0;
  const qb: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn((setter: any) => {
      const expr: string = setter.stockCurrent();
      delta = Number(expr.match(/\(([-\d]+)\)/)![1]);
      return qb;
    }),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn((_sql: string, params: any) => {
      hasGuard = true;
      required = params.required;
      return qb;
    }),
    execute: jest.fn(async () => {
      if (hasGuard && product.stockCurrent < required) {
        return { affected: 0 };
      }
      product.stockCurrent += delta;
      return { affected: 1 };
    }),
  };
  return qb;
}

function buildManagerMock(overrides: {
  productRepo?: any;
  stockItemRepo?: any;
  movementRepo?: any;
  product?: { stockCurrent: number };
}) {
  const repoMap = new Map<any, any>([
    [ProductEntity, overrides.productRepo],
    [StockItemEntity, overrides.stockItemRepo],
    [StockMovementEntity, overrides.movementRepo],
  ]);
  return {
    getRepository: jest.fn((entity: any) => repoMap.get(entity)),
    createQueryBuilder: jest.fn(() => createStockQueryBuilder(overrides.product || { stockCurrent: 0 })),
  };
}

describe('ConsumableStockService', () => {
  let dataSource: any;
  let stockItemRepository: any;
  let service: ConsumableStockService;

  beforeEach(() => {
    stockItemRepository = { find: jest.fn() };
    dataSource = { transaction: jest.fn() };
    service = new ConsumableStockService(dataSource, stockItemRepository);
  });

  function withTransaction(manager: any) {
    dataSource.transaction.mockImplementation((cb: any) => cb(manager));
  }

  const bulkProduct = { id: 'p-cable', name: 'Cable UTP', requiresSerial: false };
  const serializedProduct = { id: 'p-router', name: 'Router', requiresSerial: true };

  describe('ingresoAlmacen', () => {
    it('rechaza productos serializados', async () => {
      const manager = buildManagerMock({ productRepo: { findOneBy: jest.fn().mockResolvedValue(serializedProduct) } });
      withTransaction(manager);

      await expect(service.ingresoAlmacen({ productId: 'p-router', quantity: 10 } as any, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('incrementa el stock de almacén y guarda el movimiento', async () => {
      const productState = { stockCurrent: 20, ...bulkProduct };
      const movementRepo = { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) };
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(productState), findOneByOrFail: jest.fn().mockResolvedValue(productState) },
        movementRepo,
        product: productState,
      });
      withTransaction(manager);

      await service.ingresoAlmacen({ productId: 'p-cable', quantity: 100, supplierName: 'FiberHome' } as any, 'user-1');

      expect(productState.stockCurrent).toBe(120);
      expect(movementRepo.save).toHaveBeenCalled();
    });
  });

  describe('salidaATecnico', () => {
    it('rechaza si no hay stock suficiente en almacén', async () => {
      const productState = { stockCurrent: 5, ...bulkProduct };
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(productState) },
        stockItemRepo: { findOne: jest.fn().mockResolvedValue(null) },
        product: productState,
      });
      withTransaction(manager);

      await expect(
        service.salidaATecnico({ productId: 'p-cable', employeeId: 'emp-1', quantity: 10 } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('crea la existencia del técnico la primera vez que recibe material', async () => {
      const productState = { stockCurrent: 50, ...bulkProduct };
      const saveMock = jest.fn((e) => Promise.resolve({ id: 'si-1', ...e }));
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(productState) },
        stockItemRepo: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn((e) => e), save: saveMock },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: productState,
      });
      withTransaction(manager);

      const result = await service.salidaATecnico(
        { productId: 'p-cable', employeeId: 'emp-1', quantity: 30 } as any,
        'user-1',
      );

      expect(productState.stockCurrent).toBe(20);
      expect(result.quantity).toBe(30);
    });

    it('acumula sobre la existencia previa del técnico', async () => {
      const productState = { stockCurrent: 50, ...bulkProduct };
      const existing = { productId: 'p-cable', employeeId: 'emp-1', quantity: 10 };
      const saveMock = jest.fn((e) => Promise.resolve(e));
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(productState) },
        stockItemRepo: { findOne: jest.fn().mockResolvedValue(existing), save: saveMock },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: productState,
      });
      withTransaction(manager);

      const result = await service.salidaATecnico(
        { productId: 'p-cable', employeeId: 'emp-1', quantity: 15 } as any,
        'user-1',
      );

      expect(result.quantity).toBe(25);
    });

    it('traduce una violación de unicidad concurrente en ConflictException', async () => {
      const productState = { stockCurrent: 50, ...bulkProduct };
      const raceError: any = new Error('duplicate key');
      raceError.code = '23505';
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(productState) },
        stockItemRepo: {
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn((e) => e),
          save: jest.fn().mockRejectedValue(raceError),
        },
        product: productState,
      });
      withTransaction(manager);

      await expect(
        service.salidaATecnico({ productId: 'p-cable', employeeId: 'emp-1', quantity: 10 } as any, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('consumoEnInstalacion', () => {
    it('rechaza si el técnico no tiene existencia registrada del material', async () => {
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(bulkProduct) },
        stockItemRepo: { findOne: jest.fn().mockResolvedValue(null) },
      });
      withTransaction(manager);

      await expect(
        service.consumoEnInstalacion(
          { productId: 'p-cable', employeeId: 'emp-1', quantity: 5, ticketId: 't1' } as any,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si la cantidad solicitada excede la disponible', async () => {
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(bulkProduct) },
        stockItemRepo: { findOne: jest.fn().mockResolvedValue({ quantity: 3 }) },
      });
      withTransaction(manager);

      await expect(
        service.consumoEnInstalacion(
          { productId: 'p-cable', employeeId: 'emp-1', quantity: 10, ticketId: 't1' } as any,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('descuenta la cantidad consumida de la existencia del técnico', async () => {
      const existing = { quantity: 30 };
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(bulkProduct) },
        stockItemRepo: { findOne: jest.fn().mockResolvedValue(existing), save: jest.fn((e) => Promise.resolve(e)) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
      });
      withTransaction(manager);

      const result = await service.consumoEnInstalacion(
        { productId: 'p-cable', employeeId: 'emp-1', quantity: 12, ticketId: 't1' } as any,
        'user-1',
      );

      expect(result.quantity).toBe(18);
    });
  });

  describe('devolverAlmacen', () => {
    it('reintegra la cantidad al almacén y descuenta del técnico', async () => {
      const productState = { stockCurrent: 10, ...bulkProduct };
      const existing = { quantity: 20 };
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(productState) },
        stockItemRepo: { findOne: jest.fn().mockResolvedValue(existing), save: jest.fn((e) => Promise.resolve(e)) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: productState,
      });
      withTransaction(manager);

      const result = await service.devolverAlmacen(
        { productId: 'p-cable', employeeId: 'emp-1', quantity: 5 } as any,
        'user-1',
      );

      expect(result.quantity).toBe(15);
      expect(productState.stockCurrent).toBe(15);
    });
  });

  describe('ajustar', () => {
    it('ajusta el stock de almacén cuando no se especifica técnico', async () => {
      const productState = { stockCurrent: 10, ...bulkProduct };
      const manager = buildManagerMock({
        productRepo: {
          findOneBy: jest.fn().mockResolvedValue(productState),
          findOneByOrFail: jest.fn().mockResolvedValue(productState),
        },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: productState,
      });
      withTransaction(manager);

      const result = await service.ajustar(
        { productId: 'p-cable', quantityDelta: -3, reason: 'Merma detectada en conteo físico' } as any,
        'user-1',
      );

      expect(result.productStock).toBe(7);
    });

    it('ajusta la existencia de un técnico cuando se especifica employeeId', async () => {
      const productState = { stockCurrent: 10, ...bulkProduct };
      const existing = { quantity: 5 };
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(productState) },
        stockItemRepo: { findOne: jest.fn().mockResolvedValue(existing), save: jest.fn((e) => Promise.resolve(e)) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: productState,
      });
      withTransaction(manager);

      const result = await service.ajustar(
        { productId: 'p-cable', employeeId: 'emp-1', quantityDelta: 2, reason: 'Conteo físico de mochila técnica' } as any,
        'user-1',
      );

      expect(result.stockItem?.quantity).toBe(7);
    });
  });

  describe('getTechnicianStock', () => {
    it('delega en el repositorio con el filtro por empleado', async () => {
      stockItemRepository.find.mockResolvedValue([{ id: 'si-1' }]);
      const result = await service.getTechnicianStock('emp-1');
      expect(stockItemRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employeeId: 'emp-1' } }),
      );
      expect(result).toHaveLength(1);
    });
  });
});
