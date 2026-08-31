import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EquipmentMovementService } from './equipment-movement.service';
import { SerialNumberEntity } from '../entities/serial-number.entity';
import { EquipmentMovementEntity } from '../entities/equipment-movement.entity';
import { ProductEntity } from '../entities/product.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { EmployeeEntity } from '../../employees/entities/employee.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { Role } from '../../../common/enums/role.enum';
import { EquipmentCondition, EquipmentLocationType } from '../enums/equipment.enums';

/** Query builder encadenable que simula ProductEntity.stockCurrent += delta con guardia de no-negatividad. */
function createStockQueryBuilder(product: { stockCurrent: number }) {
  let delta = 0;
  let hasGuard = false;
  let required = 0;
  const qb: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn((setter: any) => {
      // set({ stockCurrent: () => `stock_current + (${delta})` })
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
  serialRepo?: any;
  movementRepo?: any;
  productRepo?: any;
  employeeRepo?: any;
  contractRepo?: any;
  warehouseRepo?: any;
  product?: { stockCurrent: number };
}) {
  const repoMap = new Map<any, any>([
    [SerialNumberEntity, overrides.serialRepo],
    [EquipmentMovementEntity, overrides.movementRepo],
    [ProductEntity, overrides.productRepo],
    [EmployeeEntity, overrides.employeeRepo],
    [ContractEntity, overrides.contractRepo],
    [WarehouseEntity, overrides.warehouseRepo],
  ]);

  return {
    getRepository: jest.fn((entity: any) => repoMap.get(entity)),
    createQueryBuilder: jest.fn(() => createStockQueryBuilder(overrides.product || { stockCurrent: 0 })),
  };
}

function createTechnicianEmployee(overrides: Partial<EmployeeEntity> = {}): any {
  return {
    id: 'employee-tech-1',
    cedula: '001-1111111-1',
    isActive: true,
    user: { roles: [{ name: Role.TECNICO }] },
    ...overrides,
  };
}

describe('EquipmentMovementService', () => {
  let dataSource: any;
  let serialRepository: any;
  let movementRepository: any;
  let service: EquipmentMovementService;

  beforeEach(() => {
    serialRepository = { findOneBy: jest.fn(), findOne: jest.fn(), find: jest.fn() };
    movementRepository = { findAndCount: jest.fn() };
    dataSource = { transaction: jest.fn() };
    service = new EquipmentMovementService(dataSource, serialRepository, movementRepository);
  });

  function withTransaction(manager: any) {
    dataSource.transaction.mockImplementation((cb: any) => cb(manager));
  }

  describe('ingresarEquipo', () => {
    it('crea el equipo en almacén con condición NEW cuando el producto requiere serial', async () => {
      const product = { id: 'p1', name: 'Router', requiresSerial: true };
      const warehouse = { id: 'w1', isActive: true, createdAt: new Date() };
      const saveMock = jest.fn((e) => Promise.resolve({ id: 'eq-1', ...e }));

      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue(product) },
        serialRepo: {
          findOneBy: jest.fn().mockResolvedValue(null),
          create: jest.fn((e) => e),
          save: saveMock,
        },
        warehouseRepo: { findOneBy: jest.fn(), findOne: jest.fn().mockResolvedValue(warehouse) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: { stockCurrent: 10 },
      });
      withTransaction(manager);

      const result = await service.ingresarEquipo(
        { productId: 'p1', serialNumber: 'SN-1', macAddress: 'AA:BB' },
        'user-1',
      );

      expect(result.locationType).toBe(EquipmentLocationType.WAREHOUSE);
      expect(result.condition).toBe(EquipmentCondition.NEW);
      expect(saveMock).toHaveBeenCalled();
    });

    it('rechaza el ingreso si el producto no requiere serial', async () => {
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'p1', name: 'Cable', requiresSerial: false }) },
        serialRepo: {},
        warehouseRepo: {},
      });
      withTransaction(manager);

      await expect(
        service.ingresarEquipo({ productId: 'p1', serialNumber: 'SN-1', macAddress: 'AA:BB' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si el serial ya existe', async () => {
      const manager = buildManagerMock({
        productRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'p1', requiresSerial: true }) },
        serialRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'existing' }) },
        warehouseRepo: {},
      });
      withTransaction(manager);

      await expect(
        service.ingresarEquipo({ productId: 'p1', serialNumber: 'SN-1', macAddress: 'AA:BB' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('asignarATecnico', () => {
    it('mueve el equipo de almacén a técnico y decrementa stock', async () => {
      const equipment: any = {
        id: 'eq-1',
        productId: 'p1',
        locationType: EquipmentLocationType.WAREHOUSE,
        condition: EquipmentCondition.NEW,
        currentWarehouseId: 'w1',
      };
      const technician = createTechnicianEmployee();
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment), save: jest.fn((e) => Promise.resolve(e)) },
        employeeRepo: { findOne: jest.fn().mockResolvedValue(technician) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: { stockCurrent: 5 },
      });
      withTransaction(manager);

      const result = await service.asignarATecnico('eq-1', { employeeId: technician.id }, 'user-1');

      expect(result.locationType).toBe(EquipmentLocationType.TECHNICIAN);
      expect(result.currentEmployeeId).toBe(technician.id);
      // Regresión: currentWarehouseId debe quedar explícitamente en null (no undefined),
      // porque TypeORM omite del UPDATE cualquier columna en `undefined`, dejando el
      // almacén anterior "fantasma" en la base de datos real.
      expect(result.currentWarehouseId).toBeNull();
    });

    it('rechaza si el equipo no está en almacén', async () => {
      const equipment: any = {
        id: 'eq-1',
        locationType: EquipmentLocationType.CLIENT,
        condition: EquipmentCondition.GOOD,
      };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(service.asignarATecnico('eq-1', { employeeId: 'e1' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si el equipo está dañado', async () => {
      const equipment: any = {
        id: 'eq-1',
        locationType: EquipmentLocationType.WAREHOUSE,
        condition: EquipmentCondition.DAMAGED,
      };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(service.asignarATecnico('eq-1', { employeeId: 'e1' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si el equipo no existe (lock falla)', async () => {
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(null) } });
      withTransaction(manager);

      await expect(service.asignarATecnico('eq-inexistente', { employeeId: 'e1' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rechaza si el empleado no tiene rol TECNICO', async () => {
      const equipment: any = {
        id: 'eq-1',
        locationType: EquipmentLocationType.WAREHOUSE,
        condition: EquipmentCondition.NEW,
      };
      const notTechnician = createTechnicianEmployee({ user: { roles: [{ name: Role.CAJERO }] } } as any);
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) },
        employeeRepo: { findOne: jest.fn().mockResolvedValue(notTechnician) },
      });
      withTransaction(manager);

      await expect(service.asignarATecnico('eq-1', { employeeId: notTechnician.id }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si el empleado está inactivo', async () => {
      const equipment: any = {
        id: 'eq-1',
        locationType: EquipmentLocationType.WAREHOUSE,
        condition: EquipmentCondition.NEW,
      };
      const inactiveTech = createTechnicianEmployee({ isActive: false });
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) },
        employeeRepo: { findOne: jest.fn().mockResolvedValue(inactiveTech) },
      });
      withTransaction(manager);

      await expect(service.asignarATecnico('eq-1', { employeeId: inactiveTech.id }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si no hay stock suficiente en almacén (guardia atómica)', async () => {
      const equipment: any = {
        id: 'eq-1',
        productId: 'p1',
        locationType: EquipmentLocationType.WAREHOUSE,
        condition: EquipmentCondition.NEW,
      };
      const technician = createTechnicianEmployee();
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment), save: jest.fn((e) => Promise.resolve(e)) },
        employeeRepo: { findOne: jest.fn().mockResolvedValue(technician) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: { stockCurrent: 0 }, // sin stock disponible
      });
      withTransaction(manager);

      await expect(service.asignarATecnico('eq-1', { employeeId: technician.id }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('instalarEnCliente', () => {
    it('instala el equipo cuando el contrato admite instalación', async () => {
      const equipment: any = {
        id: 'eq-1',
        locationType: EquipmentLocationType.TECHNICIAN,
        condition: EquipmentCondition.GOOD,
        currentEmployeeId: 'tech-1',
      };
      const contract = { id: 'c1', clientId: 'client-1', status: 'PENDING_INSTALL', contractNumber: 'CTR-1' };
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment), save: jest.fn((e) => Promise.resolve(e)) },
        contractRepo: { findOne: jest.fn().mockResolvedValue(contract) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
      });
      withTransaction(manager);

      const result = await service.instalarEnCliente('eq-1', { contractId: 'c1' }, 'user-1');

      expect(result.locationType).toBe(EquipmentLocationType.CLIENT);
      expect(result.clientId).toBe('client-1');
      expect(result.currentContractId).toBe('c1');
    });

    it('rechaza instalar un equipo dañado', async () => {
      const equipment: any = {
        id: 'eq-1',
        locationType: EquipmentLocationType.TECHNICIAN,
        condition: EquipmentCondition.DAMAGED,
      };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(service.instalarEnCliente('eq-1', { contractId: 'c1' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si el contrato no existe', async () => {
      const equipment: any = {
        id: 'eq-1',
        locationType: EquipmentLocationType.TECHNICIAN,
        condition: EquipmentCondition.GOOD,
      };
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) },
        contractRepo: { findOne: jest.fn().mockResolvedValue(null) },
      });
      withTransaction(manager);

      await expect(service.instalarEnCliente('eq-1', { contractId: 'c-x' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rechaza si el contrato está terminado', async () => {
      const equipment: any = {
        id: 'eq-1',
        locationType: EquipmentLocationType.TECHNICIAN,
        condition: EquipmentCondition.GOOD,
      };
      const contract = { id: 'c1', clientId: 'client-1', status: 'TERMINATED', contractNumber: 'CTR-1' };
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) },
        contractRepo: { findOne: jest.fn().mockResolvedValue(contract) },
      });
      withTransaction(manager);

      await expect(service.instalarEnCliente('eq-1', { contractId: 'c1' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('desinstalar', () => {
    it('rechaza si el equipo no está instalado en un cliente', async () => {
      const equipment: any = { id: 'eq-1', locationType: EquipmentLocationType.WAREHOUSE };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(
        service.desinstalar('eq-1', { employeeId: 'e1', reason: 'Avería reportada' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('mueve el equipo de cliente a técnico con la condición indicada', async () => {
      const equipment: any = {
        id: 'eq-1',
        locationType: EquipmentLocationType.CLIENT,
        condition: EquipmentCondition.GOOD,
        clientId: 'client-1',
      };
      const technician = createTechnicianEmployee();
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment), save: jest.fn((e) => Promise.resolve(e)) },
        employeeRepo: { findOne: jest.fn().mockResolvedValue(technician) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
      });
      withTransaction(manager);

      const result = await service.desinstalar(
        'eq-1',
        { employeeId: technician.id, reason: 'Cliente reporta sin señal', condition: EquipmentCondition.DAMAGED },
        'user-1',
      );

      expect(result.locationType).toBe(EquipmentLocationType.TECHNICIAN);
      expect(result.condition).toBe(EquipmentCondition.DAMAGED);
      expect(result.clientId).toBeNull();
    });
  });

  describe('transferirATecnico', () => {
    it('rechaza transferir al mismo técnico que ya lo tiene', async () => {
      const equipment: any = {
        id: 'eq-1',
        locationType: EquipmentLocationType.TECHNICIAN,
        currentEmployeeId: 'tech-1',
      };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(service.transferirATecnico('eq-1', { toEmployeeId: 'tech-1' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza si el equipo no está actualmente con un técnico', async () => {
      const equipment: any = { id: 'eq-1', locationType: EquipmentLocationType.WAREHOUSE };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(service.transferirATecnico('eq-1', { toEmployeeId: 'tech-2' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('reportarDano', () => {
    it('rechaza reportar daño en un equipo dado de baja', async () => {
      const equipment: any = { id: 'eq-1', locationType: EquipmentLocationType.RETIRED };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(
        service.reportarDano('eq-1', { condition: EquipmentCondition.DAMAGED, reason: 'Sobretensión' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('decrementa el stock si el equipo estaba disponible en almacén', async () => {
      const equipment: any = {
        id: 'eq-1',
        productId: 'p1',
        locationType: EquipmentLocationType.WAREHOUSE,
        condition: EquipmentCondition.GOOD,
        currentWarehouseId: 'w1',
      };
      const productState = { stockCurrent: 5 };
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment), save: jest.fn((e) => Promise.resolve(e)) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: productState,
      });
      withTransaction(manager);

      await service.reportarDano('eq-1', { condition: EquipmentCondition.DAMAGED, reason: 'Puerto quemado' }, 'user-1');

      expect(productState.stockCurrent).toBe(4);
    });
  });

  describe('enviarAReparacion', () => {
    it('rechaza si el equipo no está dañado/defectuoso', async () => {
      const equipment: any = { id: 'eq-1', locationType: EquipmentLocationType.WAREHOUSE, condition: EquipmentCondition.GOOD };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(
        service.enviarAReparacion('eq-1', { reason: 'Revisión preventiva' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si el equipo está instalado en un cliente', async () => {
      const equipment: any = { id: 'eq-1', locationType: EquipmentLocationType.CLIENT, condition: EquipmentCondition.DAMAGED };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(
        service.enviarAReparacion('eq-1', { reason: 'Puerto PON dañado' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('darDeBaja', () => {
    it('rechaza dar de baja un equipo instalado en un cliente', async () => {
      const equipment: any = { id: 'eq-1', locationType: EquipmentLocationType.CLIENT };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(
        service.darDeBaja('eq-1', { reason: 'Equipo obsoleto' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si el equipo ya está dado de baja', async () => {
      const equipment: any = { id: 'eq-1', locationType: EquipmentLocationType.RETIRED };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(
        service.darDeBaja('eq-1', { reason: 'Duplicado' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('marca como LOST cuando lost=true y decrementa stock si estaba disponible', async () => {
      const equipment: any = {
        id: 'eq-1',
        productId: 'p1',
        locationType: EquipmentLocationType.WAREHOUSE,
        condition: EquipmentCondition.GOOD,
      };
      const productState = { stockCurrent: 3 };
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment), save: jest.fn((e) => Promise.resolve(e)) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: productState,
      });
      withTransaction(manager);

      const result = await service.darDeBaja('eq-1', { lost: true, reason: 'Extravío reportado por técnico' }, 'user-1');

      expect(result.locationType).toBe(EquipmentLocationType.LOST);
      expect(productState.stockCurrent).toBe(2);
    });
  });

  describe('retornarDeReparacion', () => {
    it('rechaza si el equipo no está con un proveedor de reparación', async () => {
      const equipment: any = { id: 'eq-1', locationType: EquipmentLocationType.WAREHOUSE };
      const manager = buildManagerMock({ serialRepo: { findOne: jest.fn().mockResolvedValue(equipment) } });
      withTransaction(manager);

      await expect(service.retornarDeReparacion('eq-1', { repaired: true }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('retorna a almacén en condición GOOD e incrementa stock cuando repaired=true', async () => {
      const equipment: any = { id: 'eq-1', productId: 'p1', locationType: EquipmentLocationType.REPAIR_VENDOR };
      const warehouse = { id: 'w1', isActive: true, createdAt: new Date() };
      const productState = { stockCurrent: 2 };
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment), save: jest.fn((e) => Promise.resolve(e)) },
        warehouseRepo: { findOne: jest.fn().mockResolvedValue(warehouse) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: productState,
      });
      withTransaction(manager);

      const result = await service.retornarDeReparacion('eq-1', { repaired: true }, 'user-1');

      expect(result.locationType).toBe(EquipmentLocationType.WAREHOUSE);
      expect(result.condition).toBe(EquipmentCondition.GOOD);
      expect(productState.stockCurrent).toBe(3);
    });

    it('da de baja el equipo (SCRAPPED) sin tocar stock cuando repaired=false', async () => {
      const equipment: any = { id: 'eq-1', productId: 'p1', locationType: EquipmentLocationType.REPAIR_VENDOR };
      const productState = { stockCurrent: 2 };
      const manager = buildManagerMock({
        serialRepo: { findOne: jest.fn().mockResolvedValue(equipment), save: jest.fn((e) => Promise.resolve(e)) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: productState,
      });
      withTransaction(manager);

      const result = await service.retornarDeReparacion('eq-1', { repaired: false }, 'user-1');

      expect(result.locationType).toBe(EquipmentLocationType.RETIRED);
      expect(result.condition).toBe(EquipmentCondition.SCRAPPED);
      expect(productState.stockCurrent).toBe(2);
    });
  });

  describe('bloqueo pesimista (concurrencia)', () => {
    it('lockEquipment solicita un pessimistic_write lock sobre la fila', async () => {
      const equipment: any = { id: 'eq-1', locationType: EquipmentLocationType.WAREHOUSE, condition: EquipmentCondition.NEW };
      const findOne = jest.fn().mockResolvedValue(equipment);
      const manager = buildManagerMock({
        serialRepo: { findOne, save: jest.fn((e) => Promise.resolve(e)) },
        employeeRepo: { findOne: jest.fn().mockResolvedValue(createTechnicianEmployee()) },
        movementRepo: { create: jest.fn((e) => e), save: jest.fn().mockResolvedValue({}) },
        product: { stockCurrent: 5 },
      });
      withTransaction(manager);

      await service.asignarATecnico('eq-1', { employeeId: 'employee-tech-1' }, 'user-1');

      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'eq-1' }, lock: { mode: 'pessimistic_write' } }),
      );
    });
  });

  describe('getKardex', () => {
    it('lanza NotFoundException si el equipo no existe', async () => {
      serialRepository.findOneBy.mockResolvedValue(null);
      await expect(service.getKardex('eq-x', {})).rejects.toThrow(NotFoundException);
    });

    it('retorna el kardex paginado', async () => {
      serialRepository.findOneBy.mockResolvedValue({ id: 'eq-1' });
      movementRepository.findAndCount.mockResolvedValue([[{ id: 'm1' }], 1]);

      const result = await service.getKardex('eq-1', { page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });
  });
});
