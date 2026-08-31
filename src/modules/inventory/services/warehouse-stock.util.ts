import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { ProductEntity } from '../entities/product.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';

/**
 * Incrementa/decrementa el stock del almacén central de forma atómica
 * (UPDATE ... WHERE stock_current >= delta), sin necesidad de lock explícito:
 * la propia sentencia UPDATE serializa las escrituras concurrentes sobre la fila.
 */
export async function adjustWarehouseStock(manager: EntityManager, productId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  const qb = manager
    .createQueryBuilder()
    .update(ProductEntity)
    .set({ stockCurrent: () => `stock_current + (${delta})` })
    .where('id = :productId', { productId });
  if (delta < 0) {
    qb.andWhere('stock_current >= :required', { required: Math.abs(delta) });
  }
  const result = await qb.execute();
  if (!result.affected) {
    throw new BadRequestException('Stock insuficiente en almacén para completar el movimiento');
  }
}

export async function resolveWarehouse(
  warehouseRepo: Repository<WarehouseEntity>,
  warehouseId?: string,
): Promise<WarehouseEntity> {
  if (warehouseId) {
    const warehouse = await warehouseRepo.findOneBy({ id: warehouseId });
    if (!warehouse) {
      throw new NotFoundException(`Almacén ${warehouseId} no encontrado`);
    }
    return warehouse;
  }
  const warehouse = await warehouseRepo.findOne({ where: { isActive: true }, order: { createdAt: 'ASC' } });
  if (!warehouse) {
    throw new BadRequestException('No hay ningún almacén activo configurado en el sistema');
  }
  return warehouse;
}
