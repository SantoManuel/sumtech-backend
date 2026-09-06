import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DispatchEntity } from '../entities/dispatch.entity';
import { DispatchLineEntity } from '../entities/dispatch-line.entity';
import { SerialNumberEntity } from '../entities/serial-number.entity';
import { ProductEntity } from '../entities/product.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { EquipmentLocationType } from '../enums/equipment.enums';
import { DispatchStatus, DispatchLineType } from '../enums/dispatch.enums';
import { CreateDispatchDto, AddDispatchLineDto, RespondDispatchDto, FilterDispatchDto } from '../dto/dispatch.dto';
import { EquipmentMovementService } from './equipment-movement.service';
import { ConsumableStockService } from './consumable-stock.service';

const DISPATCH_RELATIONS = [
  'warehouse',
  'technician',
  'technician.user',
  'createdByUser',
  'lines',
  'lines.equipmentItem',
  'lines.equipmentItem.product',
  'lines.product',
];

/**
 * Orquesta el Despacho por Lotes / Manifiesto de Carga. Deliberadamente NO tiene
 * su propia lógica de custodia: en DRAFT las líneas son solo intención (no mutan
 * nada), y al confirmar ejecuta, dentro de una única transacción, las mismas
 * transiciones ya existentes en EquipmentMovementService/ConsumableStockService.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DispatchEntity)
    private readonly dispatchRepository: Repository<DispatchEntity>,
    @InjectRepository(DispatchLineEntity)
    private readonly lineRepository: Repository<DispatchLineEntity>,
    @InjectRepository(WarehouseEntity)
    private readonly warehouseRepository: Repository<WarehouseEntity>,
    private readonly equipmentMovementService: EquipmentMovementService,
    private readonly consumableStockService: ConsumableStockService,
  ) {}

  async createDraft(dto: CreateDispatchDto, userId: string): Promise<DispatchEntity> {
    const warehouse = await this.warehouseRepository.findOneBy({ id: dto.warehouseId });
    if (!warehouse) {
      throw new NotFoundException(`Almacén ${dto.warehouseId} no encontrado`);
    }
    await this.equipmentMovementService.validateTechnician(this.dispatchRepository.manager, dto.technicianId);

    const dispatch = this.dispatchRepository.create({
      warehouseId: dto.warehouseId,
      technicianId: dto.technicianId,
      notes: dto.notes,
      createdByUserId: userId,
      status: DispatchStatus.DRAFT,
    });
    return this.dispatchRepository.save(dispatch);
  }

  async addLine(dispatchId: string, dto: AddDispatchLineDto): Promise<DispatchLineEntity> {
    return this.dataSource.transaction(async (manager) => {
      const dispatch = await manager.getRepository(DispatchEntity).findOneBy({ id: dispatchId });
      if (!dispatch) {
        throw new NotFoundException(`Despacho ${dispatchId} no encontrado`);
      }
      if (dispatch.status !== DispatchStatus.DRAFT) {
        throw new BadRequestException('Solo se pueden agregar líneas a un despacho en borrador');
      }

      if (dto.lineType === DispatchLineType.EQUIPMENT) {
        if (!dto.equipmentItemId) {
          throw new BadRequestException('Debe indicar equipmentItemId para una línea de tipo EQUIPMENT');
        }
        const equipment = await manager.getRepository(SerialNumberEntity).findOneBy({ id: dto.equipmentItemId });
        if (!equipment) {
          throw new NotFoundException(`Equipo ${dto.equipmentItemId} no encontrado`);
        }
        if (equipment.locationType !== EquipmentLocationType.WAREHOUSE) {
          throw new BadRequestException(
            `El equipo debe estar en almacén para poder despacharse (estado actual: ${equipment.locationType})`,
          );
        }

        const alreadyDrafted = await manager
          .getRepository(DispatchLineEntity)
          .createQueryBuilder('l')
          .innerJoin('l.dispatch', 'd')
          .where('l.equipmentItemId = :equipmentItemId', { equipmentItemId: dto.equipmentItemId })
          .andWhere('d.status = :draft', { draft: DispatchStatus.DRAFT })
          .getOne();
        if (alreadyDrafted) {
          throw new BadRequestException('Este equipo ya está agregado en otro despacho en borrador');
        }

        return manager.getRepository(DispatchLineEntity).save(
          manager.getRepository(DispatchLineEntity).create({
            dispatchId,
            lineType: DispatchLineType.EQUIPMENT,
            equipmentItemId: dto.equipmentItemId,
          }),
        );
      }

      if (!dto.productId || !dto.quantity) {
        throw new BadRequestException('Debe indicar productId y quantity para una línea de tipo CONSUMABLE');
      }
      const product = await manager.getRepository(ProductEntity).findOneBy({ id: dto.productId });
      if (!product) {
        throw new NotFoundException(`Producto ${dto.productId} no encontrado`);
      }
      if (product.requiresSerial) {
        throw new BadRequestException(`El producto "${product.name}" requiere seriales; agréguelo como línea EQUIPMENT`);
      }

      return manager.getRepository(DispatchLineEntity).save(
        manager.getRepository(DispatchLineEntity).create({
          dispatchId,
          lineType: DispatchLineType.CONSUMABLE,
          productId: dto.productId,
          quantity: dto.quantity,
        }),
      );
    });
  }

  async removeLine(dispatchId: string, lineId: string): Promise<void> {
    const dispatch = await this.dispatchRepository.findOneBy({ id: dispatchId });
    if (!dispatch) {
      throw new NotFoundException(`Despacho ${dispatchId} no encontrado`);
    }
    if (dispatch.status !== DispatchStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden quitar líneas de un despacho en borrador');
    }
    const result = await this.lineRepository.delete({ id: lineId, dispatchId });
    if (!result.affected) {
      throw new NotFoundException(`Línea ${lineId} no encontrada en este despacho`);
    }
  }

  /**
   * Ejecuta el despacho completo en una sola transacción: cada línea llama a la
   * transición real ya existente (asignarATecnico / salidaATecnico). Si cualquier
   * línea falla (ej. el equipo ya no está en almacén), toda la transacción
   * revierte — el despacho se ejecuta entero o no se ejecuta.
   */
  async confirmDispatch(dispatchId: string, userId: string): Promise<DispatchEntity> {
    return this.dataSource.transaction(async (manager) => {
      const dispatch = await manager.getRepository(DispatchEntity).findOne({
        where: { id: dispatchId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!dispatch) {
        throw new NotFoundException(`Despacho ${dispatchId} no encontrado`);
      }
      if (dispatch.status !== DispatchStatus.DRAFT) {
        throw new BadRequestException('Solo se puede confirmar un despacho en borrador');
      }

      const lines = await manager.getRepository(DispatchLineEntity).find({ where: { dispatchId } });
      if (lines.length === 0) {
        throw new BadRequestException('El despacho no tiene líneas; agregue al menos una antes de confirmar');
      }

      for (const line of lines) {
        if (line.lineType === DispatchLineType.EQUIPMENT) {
          await this.equipmentMovementService.asignarATecnicoWithManager(
            manager,
            line.equipmentItemId!,
            { employeeId: dispatch.technicianId },
            userId,
          );
        } else {
          await this.consumableStockService.salidaATecnicoWithManager(
            manager,
            { productId: line.productId!, employeeId: dispatch.technicianId, quantity: Number(line.quantity) },
            userId,
          );
        }
      }

      dispatch.status = DispatchStatus.DISPATCHED;
      dispatch.dispatchedAt = new Date();
      return manager.getRepository(DispatchEntity).save(dispatch);
    });
  }

  /** El técnico confirma recepción, o rechaza — en cuyo caso cada línea se revierte en la misma transacción. */
  async respondToDispatch(dispatchId: string, dto: RespondDispatchDto, userId: string): Promise<DispatchEntity> {
    return this.dataSource.transaction(async (manager) => {
      const dispatch = await manager.getRepository(DispatchEntity).findOne({
        where: { id: dispatchId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!dispatch) {
        throw new NotFoundException(`Despacho ${dispatchId} no encontrado`);
      }
      if (dispatch.status !== DispatchStatus.DISPATCHED) {
        throw new BadRequestException('Solo se puede responder un despacho que ya fue enviado');
      }

      if (dto.accept) {
        dispatch.status = DispatchStatus.ACCEPTED;
        dispatch.respondedAt = new Date();
        return manager.getRepository(DispatchEntity).save(dispatch);
      }

      if (!dto.rejectionReason) {
        throw new BadRequestException('Debe indicar el motivo del rechazo');
      }

      const lines = await manager.getRepository(DispatchLineEntity).find({ where: { dispatchId } });
      for (const line of lines) {
        if (line.lineType === DispatchLineType.EQUIPMENT) {
          await this.equipmentMovementService.devolverAlmacenWithManager(
            manager,
            line.equipmentItemId!,
            userId,
            dispatch.warehouseId,
          );
        } else {
          await this.consumableStockService.devolverAlmacenWithManager(
            manager,
            { productId: line.productId!, employeeId: dispatch.technicianId, quantity: Number(line.quantity) },
            userId,
          );
        }
      }

      dispatch.status = DispatchStatus.REJECTED;
      dispatch.respondedAt = new Date();
      dispatch.rejectionReason = dto.rejectionReason;
      return manager.getRepository(DispatchEntity).save(dispatch);
    });
  }

  async findById(id: string): Promise<DispatchEntity> {
    const dispatch = await this.dispatchRepository.findOne({ where: { id }, relations: DISPATCH_RELATIONS });
    if (!dispatch) {
      throw new NotFoundException(`Despacho ${id} no encontrado`);
    }
    return dispatch;
  }

  async findAll(filter: FilterDispatchDto): Promise<{ data: DispatchEntity[]; total: number; page: number; limit: number; totalPages: number } | DispatchEntity[]> {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const query = this.dispatchRepository
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.warehouse', 'warehouse')
      .leftJoinAndSelect('d.technician', 'technician')
      .leftJoinAndSelect('technician.user', 'technicianUser')
      .leftJoinAndSelect('d.lines', 'lines')
      .leftJoinAndSelect('lines.product', 'lineProduct')
      .leftJoinAndSelect('lines.equipmentItem', 'lineEquipmentItem')
      .orderBy('d.createdAt', 'DESC');

    if (filter.technicianId) query.andWhere('d.technicianId = :technicianId', { technicianId: filter.technicianId });
    if (filter.status) query.andWhere('d.status = :status', { status: filter.status });

    // Si se especifican parámetros de paginación explícitamente o por defecto
    query.skip(skip).take(limit);
    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
