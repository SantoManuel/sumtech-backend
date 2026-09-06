import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

/** Cubre solo `lookupByCode` (escaneo rápido) — el resto del servicio no tiene spec propio aún. */
describe('InventoryService.lookupByCode', () => {
  let serialRepository: any;
  let productRepository: any;
  let service: InventoryService;

  beforeEach(() => {
    serialRepository = { findOne: jest.fn() };
    productRepository = { findOne: jest.fn() };
    service = new InventoryService(
      {} as any,
      {} as any,
      productRepository,
      serialRepository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('rechaza un código vacío', async () => {
    await expect(service.lookupByCode('   ')).rejects.toThrow(BadRequestException);
  });

  it('resuelve un equipo cuando el código coincide con un serial o MAC', async () => {
    const equipment = { id: 'eq-1', serialNumber: 'SN-1' };
    serialRepository.findOne.mockResolvedValue(equipment);

    const result = await service.lookupByCode('SN-1');

    expect(result).toEqual({ type: 'EQUIPMENT', equipment });
    expect(productRepository.findOne).not.toHaveBeenCalled();
  });

  it('resuelve un producto a granel cuando el código coincide con un SKU', async () => {
    serialRepository.findOne.mockResolvedValue(null);
    const product = { id: 'p-1', sku: 'CON-SCAPC-100' };
    productRepository.findOne.mockResolvedValue(product);

    const result = await service.lookupByCode('CON-SCAPC-100');

    expect(result).toEqual({ type: 'PRODUCT', product });
  });

  it('lanza NotFoundException si el código no coincide con nada', async () => {
    serialRepository.findOne.mockResolvedValue(null);
    productRepository.findOne.mockResolvedValue(null);

    await expect(service.lookupByCode('CODIGO-INEXISTENTE')).rejects.toThrow(NotFoundException);
  });
});

describe('InventoryService.warehouses', () => {
  let warehouseRepository: any;
  let service: InventoryService;

  beforeEach(() => {
    warehouseRepository = {
      find: jest.fn().mockResolvedValue([{ id: 'wh-1', name: 'Almacén Central', code: 'WH-01' }]),
      findOne: jest.fn().mockResolvedValue({ id: 'wh-1', name: 'Almacén Central', code: 'WH-01' }),
      findOneBy: jest.fn(),
      create: jest.fn((dto) => ({ id: 'wh-new', ...dto })),
      save: jest.fn((w) => Promise.resolve(w)),
    };

    service = new InventoryService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      warehouseRepository,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('lista todos los almacenes incluyendo relaciones geográficas', async () => {
    const warehouses = await service.findWarehouses();
    expect(warehouses).toHaveLength(1);
    expect(warehouseRepository.find).toHaveBeenCalledWith({
      relations: ['country', 'province', 'municipality', 'sector'],
      order: { name: 'ASC' },
    });
  });

  it('crea un almacén con código y ubicación geográfica', async () => {
    warehouseRepository.findOneBy.mockResolvedValue(null);
    const created = await service.createWarehouse({
      name: 'Sucursal Santiago',
      code: 'WH-STG-01',
      countryId: 'c-1',
      provinceId: 'p-1',
    });

    expect(created).toBeDefined();
    expect(warehouseRepository.save).toHaveBeenCalled();
  });

  it('rechaza crear un almacén con nombre duplicado', async () => {
    warehouseRepository.findOneBy.mockResolvedValue({ id: 'wh-1', name: 'Almacén Central' });
    await expect(
      service.createWarehouse({ name: 'Almacén Central' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('actualiza un almacén existente', async () => {
    const existingWh = { id: 'wh-1', name: 'Almacén Original', code: 'WH-01' };
    warehouseRepository.findOneBy.mockImplementation(({ id, name, code }: any) => {
      if (id === 'wh-1') return Promise.resolve(existingWh);
      if (name === 'Almacén Actualizado') return Promise.resolve(null);
      if (code) return Promise.resolve(null);
      return Promise.resolve(null);
    });
    warehouseRepository.findOne.mockResolvedValue({ id: 'wh-1', name: 'Almacén Actualizado', code: 'WH-01' });

    const updated = await service.updateWarehouse('wh-1', {
      name: 'Almacén Actualizado',
      address: 'Nueva Dirección',
    });

    expect(updated.name).toBe('Almacén Actualizado');
    expect(warehouseRepository.save).toHaveBeenCalled();
  });
});

describe('InventoryService.productsAndSuppliers', () => {
  let productRepository: any;
  let supplierRepository: any;
  let service: InventoryService;

  beforeEach(() => {
    productRepository = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto) => ({ id: 'p-new', ...dto })),
      save: jest.fn((p) => Promise.resolve(p)),
    };
    supplierRepository = {
      createQueryBuilder: jest.fn(() => ({
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 'sup-1', rnc: '1-31-88990-2', businessName: 'Huawei' }]),
      })),
      findOneBy: jest.fn(),
      create: jest.fn((dto) => ({ id: 'sup-new', ...dto })),
      save: jest.fn((s) => Promise.resolve(s)),
    };

    service = new InventoryService(
      {} as any,
      {} as any,
      productRepository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      supplierRepository,
      {} as any,
    );
  });

  it('crea un producto con SKU y valida duplicados', async () => {
    productRepository.findOneBy.mockResolvedValue(null);
    const prod = await service.createProduct({
      sku: 'RB760IGS',
      name: 'Router MikroTik hEX S',
      categoryId: 'cat-1',
      brand: 'MikroTik',
      model: 'hEX S',
      costPrice: 4200,
      salePrice: 5800,
      stockMinimum: 5,
      requiresSerial: true,
    });

    expect(prod).toBeDefined();
    expect(productRepository.save).toHaveBeenCalled();
  });

  it('crea un proveedor con RNC y valida duplicados', async () => {
    supplierRepository.findOneBy.mockResolvedValue(null);
    const supplier = await service.createSupplier({
      rnc: '1-31-88990-2',
      businessName: 'Huawei Technologies Dominicana',
      tradeName: 'Huawei',
      email: 'ventas@huawei.do',
    });

    expect(supplier).toBeDefined();
    expect(supplierRepository.save).toHaveBeenCalled();
  });

  it('rechaza crear un proveedor con RNC duplicado', async () => {
    supplierRepository.findOneBy.mockResolvedValue({ id: 'sup-1', rnc: '1-31-88990-2' });
    await expect(
      service.createSupplier({
        rnc: '1-31-88990-2',
        businessName: 'Duplicado',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('actualiza un proveedor existente', async () => {
    const existing = { id: 'sup-1', rnc: '1-31-88990-2', businessName: 'Huawei' };
    supplierRepository.findOneBy.mockImplementation(({ id, rnc }: any) => {
      if (id === 'sup-1') return Promise.resolve(existing);
      return Promise.resolve(null);
    });

    const updated = await service.updateSupplier('sup-1', {
      tradeName: 'Huawei Technologies',
      phone: '(809) 555-0101',
    });

    expect(updated).toBeDefined();
    expect(supplierRepository.save).toHaveBeenCalled();
  });
});


