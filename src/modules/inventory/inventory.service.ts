import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner, DataSource } from 'typeorm';
import { ProductEntity } from './entities/product.entity';
import { SerialNumberEntity } from './entities/serial-number.entity';
import { StockMovementEntity } from './entities/stock-movement.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { CategoryEntity } from './entities/category.entity';
import { SupplierEntity } from './entities/supplier.entity';
import { EmployeeEntity } from '../employees/entities/employee.entity';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { AssignSerialDto } from './dto/assign-serial.dto';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/create-warehouse.dto';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { RecordMovementDto } from './dto/record-movement.dto';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { FilterProductDto } from './dto/filter-inventory.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { EquipmentMovementService } from './services/equipment-movement.service';
import { adjustWarehouseStock } from './services/warehouse-stock.util';

@Injectable()
export class InventoryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly equipmentMovementService: EquipmentMovementService,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(SerialNumberEntity)
    private readonly serialRepository: Repository<SerialNumberEntity>,
    @InjectRepository(StockMovementEntity)
    private readonly movementRepository: Repository<StockMovementEntity>,
    @InjectRepository(WarehouseEntity)
    private readonly warehouseRepository: Repository<WarehouseEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
    @InjectRepository(SupplierEntity)
    private readonly supplierRepository: Repository<SupplierEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepository: Repository<EmployeeEntity>,
  ) {}

  async findAllProducts(filterDto: FilterProductDto) {
    const page = filterDto.page || 1;
    const limit = filterDto.limit || 10;
    const skip = (page - 1) * limit;

    const query = this.productRepository
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'category')
      .leftJoinAndSelect('p.supplier', 'supplier')
      .leftJoinAndSelect('p.defaultWarehouse', 'defaultWarehouse')
      .skip(skip)
      .take(limit);

    if (filterDto.categoryId) {
      query.andWhere('p.categoryId = :categoryId', { categoryId: filterDto.categoryId });
    }

    if (filterDto.search) {
      query.andWhere(
        '(p.name ILIKE :search OR p.sku ILIKE :search OR p.brand ILIKE :search OR p.model ILIKE :search)',
        { search: `%${filterDto.search}%` },
      );
    }

    const [data, total] = await query.orderBy('p.name', 'ASC').getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findLowStock() {
    return this.productRepository
      .createQueryBuilder('p')
      .where('p.stockCurrent <= p.stockMinimum')
      .orderBy('p.stockCurrent', 'ASC')
      .getMany();
  }

  async findProductById(id: string): Promise<ProductEntity> {
    const prod = await this.productRepository.findOne({
      where: { id },
      relations: ['serials', 'category', 'supplier', 'defaultWarehouse'],
    });
    if (!prod) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }
    return prod;
  }

  async createProduct(dto: CreateProductDto): Promise<ProductEntity> {
    const existing = await this.productRepository.findOneBy({ sku: dto.sku });
    if (existing) {
      throw new BadRequestException(`Ya existe un producto con el SKU "${dto.sku}"`);
    }
    const product = this.productRepository.create(dto);
    return this.productRepository.save(product);
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<ProductEntity> {
    const product = await this.productRepository.findOneBy({ id });
    if (!product) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }
    if (dto.sku && dto.sku !== product.sku) {
      const existing = await this.productRepository.findOneBy({ sku: dto.sku });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`Ya existe un producto con el SKU "${dto.sku}"`);
      }
    }
    Object.assign(product, dto);
    return this.productRepository.save(product);
  }

  async findSerials(productId?: string, status?: string) {
    const query = this.serialRepository
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.product', 'product')
      .leftJoinAndSelect('s.client', 'client');

    if (productId) query.andWhere('s.productId = :productId', { productId });
    if (status) query.andWhere('s.status = :status', { status });

    return query.orderBy('s.serialNumber', 'ASC').getMany();
  }

  /**
   * Asignación directa a cliente sin pasar por un técnico (ej. venta de mostrador
   * donde el cliente se lleva el equipo). Para el flujo normal de instalación en
   * campo (almacén → técnico → cliente), use EquipmentMovementService.
   */
  async assignSerial(dto: AssignSerialDto): Promise<SerialNumberEntity> {
    const serial = await this.serialRepository.findOne({
      where: { serialNumber: dto.serialNumber },
      relations: ['product'],
    });

    if (!serial) {
      throw new NotFoundException(`Serial ${dto.serialNumber} no encontrado`);
    }
    if (serial.status !== 'AVAILABLE' && serial.status !== 'RESERVED') {
      throw new BadRequestException(`El serial ${dto.serialNumber} no está disponible (Estado: ${serial.status})`);
    }

    serial.clientId = dto.clientId;
    serial.status = 'ASSIGNED_TO_CLIENT';
    serial.assignedAt = new Date();

    return this.serialRepository.save(serial);
  }

  async reserveStockForSale(items: { productId: string; quantity: number }[], queryRunner?: QueryRunner): Promise<void> {
    const productRepo = queryRunner ? queryRunner.manager.getRepository(ProductEntity) : this.productRepository;

    for (const item of items) {
      const prod = await productRepo.findOneBy({ id: item.productId });
      if (!prod) {
        throw new NotFoundException(`Producto ${item.productId} no encontrado para reserva`);
      }
      if (prod.stockCurrent < item.quantity) {
        throw new BadRequestException(`Stock insuficiente para el producto ${prod.name}. Disponible: ${prod.stockCurrent}, Solicitado: ${item.quantity}`);
      }

      prod.stockCurrent -= item.quantity;
      await productRepo.save(prod);
    }
  }

  /**
   * Ingreso/salida manual de almacén ("reposición simple", sin orden de compra formal).
   * - Producto serializado + IN_PURCHASE: crea un EquipmentItem por cada serial enviado.
   * - Producto a granel: ajusta ProductEntity.stockCurrent y deja kardex en StockMovementEntity.
   */
  async recordMovement(dto: RecordMovementDto, userId: string) {
    const product = await this.productRepository.findOneBy({ id: dto.productId });
    if (!product) {
      throw new NotFoundException(`Producto ${dto.productId} no encontrado`);
    }

    if (product.requiresSerial) {
      return this.recordSerializedEntry(product, dto, userId);
    }
    return this.recordBulkMovement(product, dto, userId);
  }

  private async recordSerializedEntry(product: ProductEntity, dto: RecordMovementDto, userId: string) {
    if (dto.movementType !== 'IN_PURCHASE') {
      throw new BadRequestException(
        'Para productos serializados, use los endpoints de /inventory/equipment/* para todo movimiento distinto a un ingreso inicial',
      );
    }
    if (!dto.serials || dto.serials.length === 0) {
      throw new BadRequestException('Debe indicar la lista de seriales/MAC a ingresar para un producto serializado');
    }
    if (dto.quantity && dto.quantity !== dto.serials.length) {
      throw new BadRequestException(
        `La cantidad indicada (${dto.quantity}) no coincide con la cantidad de seriales enviados (${dto.serials.length})`,
      );
    }
    const serialSet = new Set(dto.serials.map((s) => s.serialNumber));
    const providedMacs = dto.serials.map((s) => s.macAddress).filter((mac): mac is string => !!mac);
    const macSet = new Set(providedMacs);
    if (serialSet.size !== dto.serials.length || macSet.size !== providedMacs.length) {
      throw new BadRequestException('Se enviaron seriales o direcciones MAC duplicadas en la misma solicitud');
    }

    const equipmentCreated: SerialNumberEntity[] = [];
    for (const item of dto.serials) {
      equipmentCreated.push(
        await this.equipmentMovementService.ingresarEquipo(
          {
            productId: product.id,
            serialNumber: item.serialNumber,
            macAddress: item.macAddress,
            warehouseId: dto.warehouseId,
          },
          userId,
        ),
      );
    }

    const updatedProduct = await this.productRepository.findOneByOrFail({ id: product.id });
    return { product: updatedProduct, equipmentCreated };
  }

  private async recordBulkMovement(product: ProductEntity, dto: RecordMovementDto, userId: string) {
    if (dto.serials && dto.serials.length > 0) {
      throw new BadRequestException('El producto no requiere seriales; no envíe la lista de seriales');
    }

    return this.dataSource.transaction(async (manager) => {
      const previousStock = product.stockCurrent;
      let delta: number;
      let quantityForKardex: number;

      if (dto.movementType === 'ADJUSTMENT') {
        if (!dto.adjustmentDelta) {
          throw new BadRequestException('Debe indicar adjustmentDelta (distinto de 0) para un movimiento de ajuste');
        }
        delta = dto.adjustmentDelta;
        quantityForKardex = Math.abs(delta);
      } else {
        if (!dto.quantity) {
          throw new BadRequestException('Debe indicar quantity para este tipo de movimiento');
        }
        delta = dto.movementType === 'IN_PURCHASE' || dto.movementType === 'IN_REPAIR_RETURN' ? dto.quantity : -dto.quantity;
        quantityForKardex = dto.quantity;
      }

      await adjustWarehouseStock(manager, product.id, delta);
      const updated = await manager.getRepository(ProductEntity).findOneByOrFail({ id: product.id });

      await manager.getRepository(StockMovementEntity).save(
        manager.getRepository(StockMovementEntity).create({
          productId: product.id,
          movementType: dto.movementType,
          quantity: quantityForKardex,
          previousStock,
          newStock: updated.stockCurrent,
          userId,
          notes: dto.notes,
        }),
      );

      return updated;
    });
  }

  /** Lista liviana de técnicos activos para selectores de UI (sin datos sensibles como salario). */
  async listTechnicians(): Promise<{ id: string; cedula: string; jobTitle: string; username?: string }[]> {
    const employees = await this.employeeRepository.find({
      where: { isActive: true },
      relations: ['user', 'user.roles'],
    });
    return employees
      .filter((e) => e.user?.roles?.some((r) => r.name === 'TECNICO'))
      .map((e) => ({ id: e.id, cedula: e.cedula, jobTitle: e.jobTitle, username: e.user?.username }))
      .sort((a, b) => (a.username || '').localeCompare(b.username || ''));
  }

  async findWarehouses(): Promise<WarehouseEntity[]> {
    return this.warehouseRepository.find({
      relations: ['country', 'province', 'municipality', 'sector'],
      order: { name: 'ASC' },
    });
  }

  async findWarehouseById(id: string): Promise<WarehouseEntity> {
    const warehouse = await this.warehouseRepository.findOne({
      where: { id },
      relations: ['country', 'province', 'municipality', 'sector'],
    });
    if (!warehouse) {
      throw new NotFoundException(`Almacén con ID ${id} no encontrado`);
    }
    return warehouse;
  }

  async createWarehouse(dto: CreateWarehouseDto): Promise<WarehouseEntity> {
    const existing = await this.warehouseRepository.findOneBy({ name: dto.name });
    if (existing) {
      throw new BadRequestException(`Ya existe un almacén con el nombre "${dto.name}"`);
    }
    if (dto.code) {
      const existingCode = await this.warehouseRepository.findOneBy({ code: dto.code });
      if (existingCode) {
        throw new BadRequestException(`Ya existe un almacén con el código "${dto.code}"`);
      }
    }
    const warehouse = this.warehouseRepository.create(dto);
    const saved = await this.warehouseRepository.save(warehouse);
    return this.findWarehouseById(saved.id);
  }

  async updateWarehouse(id: string, dto: UpdateWarehouseDto): Promise<WarehouseEntity> {
    const warehouse = await this.warehouseRepository.findOneBy({ id });
    if (!warehouse) {
      throw new NotFoundException(`Almacén con ID ${id} no encontrado`);
    }

    if (dto.name && dto.name !== warehouse.name) {
      const existing = await this.warehouseRepository.findOneBy({ name: dto.name });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`Ya existe un almacén con el nombre "${dto.name}"`);
      }
    }

    if (dto.code && dto.code !== warehouse.code) {
      const existingCode = await this.warehouseRepository.findOneBy({ code: dto.code });
      if (existingCode && existingCode.id !== id) {
        throw new BadRequestException(`Ya existe un almacén con el código "${dto.code}"`);
      }
    }

    Object.assign(warehouse, dto);
    await this.warehouseRepository.save(warehouse);
    return this.findWarehouseById(id);
  }

  // ---------- Categorías ----------

  async findAllCategories(): Promise<CategoryEntity[]> {
    return this.categoryRepository.find({ order: { name: 'ASC' } });
  }

  async findCategoryById(id: string): Promise<CategoryEntity> {
    const category = await this.categoryRepository.findOneBy({ id });
    if (!category) {
      throw new NotFoundException(`Categoría ${id} no encontrada`);
    }
    return category;
  }

  async createCategory(dto: CreateCategoryDto): Promise<CategoryEntity> {
    const existing = await this.categoryRepository.findOneBy({ code: dto.code });
    if (existing) {
      throw new BadRequestException(`Ya existe una categoría con el código "${dto.code}"`);
    }
    return this.categoryRepository.save(this.categoryRepository.create(dto));
  }

  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<CategoryEntity> {
    const category = await this.findCategoryById(id);
    Object.assign(category, dto);
    return this.categoryRepository.save(category);
  }

  // ---------- Búsqueda unificada (escaneo rápido) ----------

  /**
   * Resuelve un código escaneado (serial, MAC o SKU) a un equipo o producto, en
   * ese orden. Pensado para alimentar el flujo de escaneo del Despacho por Lotes:
   * un equipo se agrega directo a la línea, un producto a granel pide cantidad.
   */
  async lookupByCode(
    code: string,
  ): Promise<{ type: 'EQUIPMENT'; equipment: SerialNumberEntity } | { type: 'PRODUCT'; product: ProductEntity }> {
    const trimmed = code?.trim();
    if (!trimmed) {
      throw new BadRequestException('Debe indicar un código para buscar');
    }

    const equipment = await this.serialRepository.findOne({
      where: [{ serialNumber: trimmed }, { macAddress: trimmed }],
      relations: ['product', 'product.category', 'product.supplier', 'product.defaultWarehouse'],
    });
    if (equipment) {
      return { type: 'EQUIPMENT', equipment };
    }

    const product = await this.productRepository.findOne({
      where: [{ sku: trimmed }, { barcode: trimmed }, { manufacturerCode: trimmed }],
      relations: ['category', 'supplier', 'defaultWarehouse'],
    });
    if (product) {
      return { type: 'PRODUCT', product };
    }

    throw new NotFoundException(`No se encontró ningún equipo ni producto con el código "${trimmed}"`);
  }

  // ---------- Proveedores ----------

  async findSuppliers(search?: string, isActive?: boolean): Promise<SupplierEntity[]> {
    const query = this.supplierRepository.createQueryBuilder('s').orderBy('s.businessName', 'ASC');
    if (isActive !== undefined) {
      query.andWhere('s.isActive = :isActive', { isActive });
    }
    if (search) {
      query.andWhere(
        '(s.businessName ILIKE :search OR s.tradeName ILIKE :search OR s.rnc ILIKE :search OR s.contactPerson ILIKE :search)',
        { search: `%${search}%` },
      );
    }
    return query.getMany();
  }

  async findSupplierById(id: string): Promise<SupplierEntity> {
    const supplier = await this.supplierRepository.findOneBy({ id });
    if (!supplier) {
      throw new NotFoundException(`Proveedor con ID ${id} no encontrado`);
    }
    return supplier;
  }

  async createSupplier(dto: CreateSupplierDto): Promise<SupplierEntity> {
    const existing = await this.supplierRepository.findOneBy({ rnc: dto.rnc });
    if (existing) {
      throw new BadRequestException(`Ya existe un proveedor registrado con el RNC "${dto.rnc}"`);
    }
    const supplier = this.supplierRepository.create(dto);
    return this.supplierRepository.save(supplier);
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto): Promise<SupplierEntity> {
    const supplier = await this.supplierRepository.findOneBy({ id });
    if (!supplier) {
      throw new NotFoundException(`Proveedor con ID ${id} no encontrado`);
    }
    if (dto.rnc && dto.rnc !== supplier.rnc) {
      const existing = await this.supplierRepository.findOneBy({ rnc: dto.rnc });
      if (existing && existing.id !== id) {
        throw new BadRequestException(`Ya existe un proveedor registrado con el RNC "${dto.rnc}"`);
      }
    }
    Object.assign(supplier, dto);
    return this.supplierRepository.save(supplier);
  }
}
