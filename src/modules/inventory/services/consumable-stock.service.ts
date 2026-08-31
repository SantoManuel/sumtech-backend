import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ProductEntity } from '../entities/product.entity';
import { StockItemEntity } from '../entities/stock-item.entity';
import { StockMovementEntity } from '../entities/stock-movement.entity';
import {
  IngresoConsumableDto,
  SalidaATecnicoDto,
  ConsumoInstalacionDto,
  DevolucionAlmacenConsumableDto,
  AjusteConsumableDto,
} from '../dto/consumable-stock.dto';
import { adjustWarehouseStock } from './warehouse-stock.util';

const UNIQUE_VIOLATION = '23505';

/**
 * Motor de existencias de materiales a granel (no serializados: cable,
 * conectores, splitters). El almacén central se representa con
 * ProductEntity.stockCurrent; lo que cada técnico lleva consigo vive en
 * StockItemEntity. Cada movimiento queda en el kardex (StockMovementEntity).
 */
@Injectable()
export class ConsumableStockService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(StockItemEntity)
    private readonly stockItemRepository: Repository<StockItemEntity>,
  ) {}

  async ingresoAlmacen(dto: IngresoConsumableDto, userId: string): Promise<ProductEntity> {
    return this.dataSource.transaction(async (manager) => {
      const product = await this.validateBulkProduct(manager, dto.productId);
      const previousStock = product.stockCurrent;

      await adjustWarehouseStock(manager, product.id, dto.quantity);

      await this.saveMovement(manager, {
        productId: product.id,
        movementType: 'IN_PURCHASE',
        quantity: dto.quantity,
        previousStock,
        newStock: previousStock + dto.quantity,
        userId,
        referenceId: dto.invoiceReference,
        notes: dto.supplierName ? `Proveedor: ${dto.supplierName}. ${dto.notes || ''}`.trim() : dto.notes,
      });

      return manager.getRepository(ProductEntity).findOneByOrFail({ id: product.id });
    });
  }

  async salidaATecnico(dto: SalidaATecnicoDto, userId: string): Promise<StockItemEntity> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const product = await this.validateBulkProduct(manager, dto.productId);
        const previousStock = product.stockCurrent;

        await adjustWarehouseStock(manager, product.id, -dto.quantity);
        const stockItem = await this.incrementTechnicianStock(manager, dto.productId, dto.employeeId, dto.quantity);

        await this.saveMovement(manager, {
          productId: product.id,
          movementType: 'OUT_TO_TECHNICIAN',
          quantity: dto.quantity,
          previousStock,
          newStock: previousStock - dto.quantity,
          userId,
          employeeId: dto.employeeId,
          ticketId: dto.ticketId,
          notes: dto.notes,
        });

        return stockItem;
      });
    } catch (error) {
      throw this.translateConcurrencyError(error);
    }
  }

  async consumoEnInstalacion(dto: ConsumoInstalacionDto, userId: string): Promise<StockItemEntity> {
    return this.dataSource.transaction(async (manager) => {
      await this.validateBulkProduct(manager, dto.productId);
      const stockItem = await this.incrementTechnicianStock(manager, dto.productId, dto.employeeId, -dto.quantity);

      await this.saveMovement(manager, {
        productId: dto.productId,
        movementType: 'OUT_CONSUMED_INSTALLATION',
        quantity: dto.quantity,
        previousStock: Number(stockItem.quantity) + dto.quantity,
        newStock: Number(stockItem.quantity),
        userId,
        employeeId: dto.employeeId,
        ticketId: dto.ticketId,
        notes: dto.notes,
      });

      return stockItem;
    });
  }

  async devolverAlmacen(dto: DevolucionAlmacenConsumableDto, userId: string): Promise<StockItemEntity> {
    return this.dataSource.transaction(async (manager) => {
      const product = await this.validateBulkProduct(manager, dto.productId);
      const previousStock = product.stockCurrent;

      const stockItem = await this.incrementTechnicianStock(manager, dto.productId, dto.employeeId, -dto.quantity);
      await adjustWarehouseStock(manager, product.id, dto.quantity);

      await this.saveMovement(manager, {
        productId: product.id,
        movementType: 'IN_RETURN_FROM_TECHNICIAN',
        quantity: dto.quantity,
        previousStock,
        newStock: previousStock + dto.quantity,
        userId,
        employeeId: dto.employeeId,
        notes: dto.notes,
      });

      return stockItem;
    });
  }

  async ajustar(dto: AjusteConsumableDto, userId: string): Promise<{ productStock: number; stockItem?: StockItemEntity }> {
    try {
      return await this.ajustarInternal(dto, userId);
    } catch (error) {
      throw this.translateConcurrencyError(error);
    }
  }

  private async ajustarInternal(
    dto: AjusteConsumableDto,
    userId: string,
  ): Promise<{ productStock: number; stockItem?: StockItemEntity }> {
    return this.dataSource.transaction(async (manager) => {
      const product = await this.validateBulkProduct(manager, dto.productId);

      if (dto.employeeId) {
        const previousStock = product.stockCurrent;
        const stockItem = await this.incrementTechnicianStock(manager, dto.productId, dto.employeeId, dto.quantityDelta);
        await this.saveMovement(manager, {
          productId: product.id,
          movementType: 'ADJUSTMENT',
          quantity: Math.abs(dto.quantityDelta),
          previousStock,
          newStock: previousStock,
          userId,
          employeeId: dto.employeeId,
          notes: `Ajuste de conteo físico en poder de técnico. Motivo: ${dto.reason}`,
        });
        return { productStock: product.stockCurrent, stockItem };
      }

      const previousStock = product.stockCurrent;
      await adjustWarehouseStock(manager, product.id, dto.quantityDelta);
      const updated = await manager.getRepository(ProductEntity).findOneByOrFail({ id: product.id });

      await this.saveMovement(manager, {
        productId: product.id,
        movementType: 'ADJUSTMENT',
        quantity: Math.abs(dto.quantityDelta),
        previousStock,
        newStock: updated.stockCurrent,
        userId,
        notes: `Ajuste de conteo físico en almacén. Motivo: ${dto.reason}`,
      });

      return { productStock: updated.stockCurrent };
    });
  }

  async getTechnicianStock(employeeId: string): Promise<StockItemEntity[]> {
    return this.stockItemRepository.find({
      where: { employeeId },
      relations: ['product'],
      order: { updatedAt: 'DESC' },
    });
  }

  private async validateBulkProduct(manager: EntityManager, productId: string): Promise<ProductEntity> {
    const product = await manager.getRepository(ProductEntity).findOneBy({ id: productId });
    if (!product) {
      throw new NotFoundException(`Producto ${productId} no encontrado`);
    }
    if (product.requiresSerial) {
      throw new BadRequestException(
        `El producto "${product.name}" requiere seriales individuales; use el flujo de equipos serializados`,
      );
    }
    return product;
  }

  /**
   * Incrementa (delta>0) o decrementa (delta<0) el stock de un técnico.
   * Lockea la fila si existe; si no existe y delta<0, no hay nada que descontar.
   */
  private async incrementTechnicianStock(
    manager: EntityManager,
    productId: string,
    employeeId: string,
    delta: number,
  ): Promise<StockItemEntity> {
    const repo = manager.getRepository(StockItemEntity);
    const existing = await repo.findOne({ where: { productId, employeeId }, lock: { mode: 'pessimistic_write' } });

    if (!existing) {
      if (delta < 0) {
        throw new BadRequestException('El técnico no tiene existencia registrada de este material');
      }
      return repo.save(repo.create({ productId, employeeId, quantity: delta }));
    }

    const newQuantity = Number(existing.quantity) + delta;
    if (newQuantity < 0) {
      throw new BadRequestException(
        `Cantidad insuficiente en poder del técnico. Disponible: ${existing.quantity}, solicitado: ${Math.abs(delta)}`,
      );
    }
    existing.quantity = newQuantity;
    return repo.save(existing);
  }

  private async saveMovement(
    manager: EntityManager,
    data: {
      productId: string;
      movementType: StockMovementEntity['movementType'];
      quantity: number;
      previousStock: number;
      newStock: number;
      userId: string;
      employeeId?: string;
      ticketId?: string;
      referenceId?: string;
      notes?: string;
    },
  ): Promise<void> {
    const repo = manager.getRepository(StockMovementEntity);
    await repo.save(
      repo.create({
        productId: data.productId,
        movementType: data.movementType,
        quantity: data.quantity,
        previousStock: data.previousStock,
        newStock: data.newStock,
        userId: data.userId,
        employeeId: data.employeeId,
        ticketId: data.ticketId,
        referenceId: data.referenceId,
        notes: data.notes,
      }),
    );
  }

  /** Traduce una violación de unicidad concurrente (alta simultánea de un mismo StockItem) en un error claro para reintentar. */
  private translateConcurrencyError(error: any): Error {
    if (error?.code === UNIQUE_VIOLATION) {
      return new ConflictException(
        'Se detectó una operación concurrente sobre la misma existencia de material; intente nuevamente',
      );
    }
    return error;
  }
}
