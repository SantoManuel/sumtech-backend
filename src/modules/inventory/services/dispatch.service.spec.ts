import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { DispatchEntity } from '../entities/dispatch.entity';
import { DispatchLineEntity } from '../entities/dispatch-line.entity';
import { SerialNumberEntity } from '../entities/serial-number.entity';
import { ProductEntity } from '../entities/product.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { DispatchStatus, DispatchLineType } from '../enums/dispatch.enums';
import { EquipmentLocationType } from '../enums/equipment.enums';

function buildManagerMock(overrides: {
  dispatchRepo?: any;
  lineRepo?: any;
  serialRepo?: any;
  productRepo?: any;
}) {
  const repoMap = new Map<any, any>([
    [DispatchEntity, overrides.dispatchRepo],
    [DispatchLineEntity, overrides.lineRepo],
    [SerialNumberEntity, overrides.serialRepo],
    [ProductEntity, overrides.productRepo],
  ]);
  return { getRepository: jest.fn((entity: any) => repoMap.get(entity)) };
}

describe('DispatchService', () => {
  let dataSource: any;
  let dispatchRepository: any;
  let lineRepository: any;
  let warehouseRepository: any;
  let equipmentMovementService: any;
  let consumableStockService: any;
  let service: DispatchService;

  beforeEach(() => {
    dispatchRepository = {
      findOneBy: jest.fn(),
      create: jest.fn((e) => e),
      save: jest.fn((e) => Promise.resolve({ id: 'd1', ...e })),
      manager: {},
    };
    lineRepository = { delete: jest.fn() };
    warehouseRepository = { findOneBy: jest.fn() };
    equipmentMovementService = {
      validateTechnician: jest.fn().mockResolvedValue({ id: 'tech-1' }),
      asignarATecnicoWithManager: jest.fn().mockResolvedValue({}),
      devolverAlmacenWithManager: jest.fn().mockResolvedValue({}),
    };
    consumableStockService = {
      salidaATecnicoWithManager: jest.fn().mockResolvedValue({}),
      devolverAlmacenWithManager: jest.fn().mockResolvedValue({}),
    };
    dataSource = { transaction: jest.fn() };
    service = new DispatchService(
      dataSource,
      dispatchRepository,
      lineRepository,
      warehouseRepository,
      equipmentMovementService,
      consumableStockService,
    );
  });

  function withTransaction(manager: any) {
    dataSource.transaction.mockImplementation((cb: any) => cb(manager));
  }

  describe('createDraft', () => {
    it('rechaza si el almacén no existe', async () => {
      warehouseRepository.findOneBy.mockResolvedValue(null);
      await expect(service.createDraft({ warehouseId: 'w1', technicianId: 't1' } as any, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('crea el despacho en estado DRAFT tras validar técnico y almacén', async () => {
      warehouseRepository.findOneBy.mockResolvedValue({ id: 'w1' });
      const result = await service.createDraft({ warehouseId: 'w1', technicianId: 't1' } as any, 'user-1');
      expect(equipmentMovementService.validateTechnician).toHaveBeenCalledWith(dispatchRepository.manager, 't1');
      expect(result.status).toBe(DispatchStatus.DRAFT);
    });
  });

  describe('addLine', () => {
    it('rechaza agregar líneas si el despacho no está en DRAFT', async () => {
      const manager = buildManagerMock({
        dispatchRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'd1', status: DispatchStatus.DISPATCHED }) },
      });
      withTransaction(manager);

      await expect(service.addLine('d1', { lineType: DispatchLineType.EQUIPMENT, equipmentItemId: 'eq1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza una línea de equipo que no está en almacén', async () => {
      const manager = buildManagerMock({
        dispatchRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'd1', status: DispatchStatus.DRAFT }) },
        serialRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'eq1', locationType: EquipmentLocationType.TECHNICIAN }) },
      });
      withTransaction(manager);

      await expect(service.addLine('d1', { lineType: DispatchLineType.EQUIPMENT, equipmentItemId: 'eq1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza un equipo ya agregado en otro despacho en borrador', async () => {
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing-line' }),
      };
      const manager = buildManagerMock({
        dispatchRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'd1', status: DispatchStatus.DRAFT }) },
        serialRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'eq1', locationType: EquipmentLocationType.WAREHOUSE }) },
        lineRepo: { createQueryBuilder: jest.fn(() => qb) },
      });
      withTransaction(manager);

      await expect(service.addLine('d1', { lineType: DispatchLineType.EQUIPMENT, equipmentItemId: 'eq1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('agrega una línea de equipo válida', async () => {
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      const manager = buildManagerMock({
        dispatchRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'd1', status: DispatchStatus.DRAFT }) },
        serialRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'eq1', locationType: EquipmentLocationType.WAREHOUSE }) },
        lineRepo: { createQueryBuilder: jest.fn(() => qb), create: jest.fn((e) => e), save: jest.fn((e) => Promise.resolve(e)) },
      });
      withTransaction(manager);

      const result = await service.addLine('d1', { lineType: DispatchLineType.EQUIPMENT, equipmentItemId: 'eq1' });
      expect(result.lineType).toBe(DispatchLineType.EQUIPMENT);
    });

    it('rechaza una línea de consumible si el producto requiere serial', async () => {
      const manager = buildManagerMock({
        dispatchRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'd1', status: DispatchStatus.DRAFT }) },
        productRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'p1', name: 'ONU', requiresSerial: true }) },
      });
      withTransaction(manager);

      await expect(
        service.addLine('d1', { lineType: DispatchLineType.CONSUMABLE, productId: 'p1', quantity: 5 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirmDispatch', () => {
    it('rechaza confirmar un despacho sin líneas', async () => {
      const manager = buildManagerMock({
        dispatchRepo: { findOne: jest.fn().mockResolvedValue({ id: 'd1', status: DispatchStatus.DRAFT }) },
        lineRepo: { find: jest.fn().mockResolvedValue([]) },
      });
      withTransaction(manager);

      await expect(service.confirmDispatch('d1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('ejecuta asignarATecnico y salidaATecnico para cada línea y marca DISPATCHED', async () => {
      const dispatch: any = { id: 'd1', status: DispatchStatus.DRAFT, technicianId: 'tech-1', warehouseId: 'w1' };
      const lines = [
        { lineType: DispatchLineType.EQUIPMENT, equipmentItemId: 'eq1' },
        { lineType: DispatchLineType.CONSUMABLE, productId: 'p1', quantity: 10 },
      ];
      const manager = buildManagerMock({
        dispatchRepo: {
          findOne: jest.fn().mockResolvedValue(dispatch),
          save: jest.fn((e) => Promise.resolve(e)),
        },
        lineRepo: { find: jest.fn().mockResolvedValue(lines) },
      });
      withTransaction(manager);

      const result = await service.confirmDispatch('d1', 'user-1');

      expect(equipmentMovementService.asignarATecnicoWithManager).toHaveBeenCalledWith(
        manager,
        'eq1',
        { employeeId: 'tech-1' },
        'user-1',
      );
      expect(consumableStockService.salidaATecnicoWithManager).toHaveBeenCalledWith(
        manager,
        { productId: 'p1', employeeId: 'tech-1', quantity: 10 },
        'user-1',
      );
      expect(result.status).toBe(DispatchStatus.DISPATCHED);
    });

    it('propaga el error sin marcar DISPATCHED si una línea falla (para que la transacción revierta)', async () => {
      const dispatch: any = { id: 'd1', status: DispatchStatus.DRAFT, technicianId: 'tech-1', warehouseId: 'w1' };
      const lines = [{ lineType: DispatchLineType.EQUIPMENT, equipmentItemId: 'eq1' }];
      equipmentMovementService.asignarATecnicoWithManager.mockRejectedValue(
        new BadRequestException('El equipo ya no está en almacén'),
      );
      const saveSpy = jest.fn((e: any) => Promise.resolve(e));
      const manager = buildManagerMock({
        dispatchRepo: { findOne: jest.fn().mockResolvedValue(dispatch), save: saveSpy },
        lineRepo: { find: jest.fn().mockResolvedValue(lines) },
      });
      withTransaction(manager);

      await expect(service.confirmDispatch('d1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  describe('respondToDispatch', () => {
    it('rechaza responder un despacho que no está DISPATCHED', async () => {
      const manager = buildManagerMock({
        dispatchRepo: { findOne: jest.fn().mockResolvedValue({ id: 'd1', status: DispatchStatus.DRAFT }) },
      });
      withTransaction(manager);

      await expect(service.respondToDispatch('d1', { accept: true } as any, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('acepta el despacho sin revertir ninguna línea', async () => {
      const dispatch: any = { id: 'd1', status: DispatchStatus.DISPATCHED, technicianId: 'tech-1', warehouseId: 'w1' };
      const manager = buildManagerMock({
        dispatchRepo: { findOne: jest.fn().mockResolvedValue(dispatch), save: jest.fn((e) => Promise.resolve(e)) },
      });
      withTransaction(manager);

      const result = await service.respondToDispatch('d1', { accept: true } as any, 'user-1');

      expect(result.status).toBe(DispatchStatus.ACCEPTED);
      expect(equipmentMovementService.devolverAlmacenWithManager).not.toHaveBeenCalled();
    });

    it('rechaza el rechazo sin motivo', async () => {
      const dispatch: any = { id: 'd1', status: DispatchStatus.DISPATCHED, technicianId: 'tech-1' };
      const manager = buildManagerMock({ dispatchRepo: { findOne: jest.fn().mockResolvedValue(dispatch) } });
      withTransaction(manager);

      await expect(service.respondToDispatch('d1', { accept: false } as any, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('al rechazar, revierte cada línea al almacén de origen', async () => {
      const dispatch: any = { id: 'd1', status: DispatchStatus.DISPATCHED, technicianId: 'tech-1', warehouseId: 'w1' };
      const lines = [
        { lineType: DispatchLineType.EQUIPMENT, equipmentItemId: 'eq1' },
        { lineType: DispatchLineType.CONSUMABLE, productId: 'p1', quantity: 10 },
      ];
      const manager = buildManagerMock({
        dispatchRepo: { findOne: jest.fn().mockResolvedValue(dispatch), save: jest.fn((e) => Promise.resolve(e)) },
        lineRepo: { find: jest.fn().mockResolvedValue(lines) },
      });
      withTransaction(manager);

      const result = await service.respondToDispatch(
        'd1',
        { accept: false, rejectionReason: 'Técnico reporta equipo dañado' } as any,
        'user-1',
      );

      expect(equipmentMovementService.devolverAlmacenWithManager).toHaveBeenCalledWith(manager, 'eq1', 'user-1', 'w1');
      expect(consumableStockService.devolverAlmacenWithManager).toHaveBeenCalledWith(
        manager,
        { productId: 'p1', employeeId: 'tech-1', quantity: 10 },
        'user-1',
      );
      expect(result.status).toBe(DispatchStatus.REJECTED);
    });
  });

  describe('findAll', () => {
    it('retorna la lista de despachos incluyendo almacén, técnico y líneas asociadas', async () => {
      const mockQueryBuilder: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'd1',
            status: DispatchStatus.DISPATCHED,
            lines: [{ id: 'l1', lineType: DispatchLineType.EQUIPMENT }],
          },
        ]),
      };
      (dispatchRepository.createQueryBuilder as jest.Mock) = jest.fn().mockReturnValue(mockQueryBuilder);

      const result = await service.findAll({});

      expect(result).toHaveLength(1);
      expect(result[0].lines).toHaveLength(1);
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('d.lines', 'lines');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('lines.product', 'lineProduct');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('lines.equipmentItem', 'lineEquipmentItem');
    });
  });
});
