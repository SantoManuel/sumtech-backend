import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { SerialNumberEntity } from '../entities/serial-number.entity';
import { EquipmentMovementEntity } from '../entities/equipment-movement.entity';
import { ProductEntity } from '../entities/product.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { EmployeeEntity } from '../../employees/entities/employee.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { Role } from '../../../common/enums/role.enum';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  AssignTechnicianDto,
  InstallAtClientDto,
  UninstallDto,
  TransferTechnicianDto,
  ReportDamageDto,
  SendToRepairDto,
  ReturnFromRepairDto,
  RetireEquipmentDto,
  AdjustEquipmentDto,
} from '../dto/equipment-actions.dto';
import { FilterSerialDto } from '../dto/filter-inventory.dto';
import {
  EquipmentCondition,
  EquipmentLocationType,
  EquipmentMovementType,
  deriveLegacyStatus,
} from '../enums/equipment.enums';
import { adjustWarehouseStock, resolveWarehouse } from './warehouse-stock.util';

const USABLE_CONDITIONS = [EquipmentCondition.NEW, EquipmentCondition.GOOD];

interface TransitionChanges {
  movementType: EquipmentMovementType;
  toLocationType: EquipmentLocationType;
  toWarehouseId?: string | null;
  toEmployeeId?: string | null;
  toClientId?: string | null;
  toContractId?: string | null;
  conditionAfter: EquipmentCondition;
  ticketId?: string;
  reason?: string;
  notes?: string;
}

/**
 * Motor de trazabilidad de equipos serializados (CPE): centraliza TODAS las
 * transiciones de custodia/condición y garantiza que cada una quede en el
 * kardex (EquipmentMovementEntity) de forma atómica junto al cambio de estado.
 */
@Injectable()
export class EquipmentMovementService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SerialNumberEntity)
    private readonly serialRepository: Repository<SerialNumberEntity>,
    @InjectRepository(EquipmentMovementEntity)
    private readonly movementRepository: Repository<EquipmentMovementEntity>,
  ) {}

  async ingresarEquipo(
    input: { productId: string; serialNumber: string; macAddress: string; warehouseId?: string },
    userId: string,
  ): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const productRepo = manager.getRepository(ProductEntity);
      const serialRepo = manager.getRepository(SerialNumberEntity);
      const warehouseRepo = manager.getRepository(WarehouseEntity);

      const product = await productRepo.findOneBy({ id: input.productId });
      if (!product) {
        throw new NotFoundException(`Producto ${input.productId} no encontrado`);
      }
      if (!product.requiresSerial) {
        throw new BadRequestException(
          `El producto "${product.name}" no requiere seriales; use el flujo de materiales a granel`,
        );
      }

      const [existingSerial, existingMac] = await Promise.all([
        serialRepo.findOneBy({ serialNumber: input.serialNumber }),
        serialRepo.findOneBy({ macAddress: input.macAddress }),
      ]);
      if (existingSerial) {
        throw new BadRequestException(`El serial ${input.serialNumber} ya existe en el sistema`);
      }
      if (existingMac) {
        throw new BadRequestException(`La dirección MAC ${input.macAddress} ya está registrada`);
      }

      const warehouse = await resolveWarehouse(warehouseRepo, input.warehouseId);

      const equipment = serialRepo.create({
        productId: input.productId,
        serialNumber: input.serialNumber,
        macAddress: input.macAddress,
        locationType: EquipmentLocationType.WAREHOUSE,
        condition: EquipmentCondition.NEW,
        currentWarehouseId: warehouse.id,
        status: deriveLegacyStatus(EquipmentLocationType.WAREHOUSE, EquipmentCondition.NEW),
        lastMovementAt: new Date(),
      });
      const saved = await serialRepo.save(equipment);

      await adjustWarehouseStock(manager, product.id, 1);

      await manager.getRepository(EquipmentMovementEntity).save(
        manager.getRepository(EquipmentMovementEntity).create({
          equipmentItemId: saved.id,
          movementType: EquipmentMovementType.INGRESO_ALMACEN,
          toLocationType: EquipmentLocationType.WAREHOUSE,
          toWarehouseId: warehouse.id,
          conditionAfter: EquipmentCondition.NEW,
          performedByUserId: userId,
        }),
      );

      return saved;
    });
  }

  async asignarATecnico(equipmentItemId: string, dto: AssignTechnicianDto, userId: string): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.lockEquipment(manager, equipmentItemId);

      if (equipment.locationType !== EquipmentLocationType.WAREHOUSE) {
        throw new BadRequestException(
          `Solo se puede asignar a un técnico un equipo que esté en almacén (estado actual: ${equipment.locationType})`,
        );
      }
      if (!USABLE_CONDITIONS.includes(equipment.condition)) {
        throw new BadRequestException(
          `El equipo no está en condición apta para asignar (condición actual: ${equipment.condition})`,
        );
      }

      const employee = await this.validateTechnician(manager, dto.employeeId);

      const saved = await this.persistTransition(
        manager,
        equipment,
        {
          movementType: EquipmentMovementType.ASIGNAR_A_TECNICO,
          toLocationType: EquipmentLocationType.TECHNICIAN,
          toEmployeeId: employee.id,
          conditionAfter: equipment.condition,
          notes: dto.notes,
        },
        userId,
      );

      await adjustWarehouseStock(manager, saved.productId, -1);
      return saved;
    });
  }

  async instalarEnCliente(
    equipmentItemId: string,
    dto: InstallAtClientDto,
    userId: string,
  ): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.lockEquipment(manager, equipmentItemId);

      if (equipment.locationType !== EquipmentLocationType.TECHNICIAN) {
        throw new BadRequestException(
          `Solo un técnico que tenga el equipo en su poder puede instalarlo (estado actual: ${equipment.locationType})`,
        );
      }
      if (!USABLE_CONDITIONS.includes(equipment.condition)) {
        throw new BadRequestException(`No se puede instalar un equipo en condición ${equipment.condition}`);
      }

      const contract = await manager.getRepository(ContractEntity).findOne({ where: { id: dto.contractId } });
      if (!contract) {
        throw new NotFoundException(`Contrato ${dto.contractId} no encontrado`);
      }
      if (!['PENDING_INSTALL', 'ACTIVE'].includes(contract.status)) {
        throw new BadRequestException(
          `El contrato ${contract.contractNumber} no admite instalación de equipos (estado: ${contract.status})`,
        );
      }

      return this.persistTransition(
        manager,
        equipment,
        {
          movementType: EquipmentMovementType.INSTALAR_EN_CLIENTE,
          toLocationType: EquipmentLocationType.CLIENT,
          toClientId: contract.clientId,
          toContractId: contract.id,
          conditionAfter: equipment.condition,
          notes: dto.notes,
        },
        userId,
      );
    });
  }

  async desinstalar(equipmentItemId: string, dto: UninstallDto, userId: string): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.lockEquipment(manager, equipmentItemId);

      if (equipment.locationType !== EquipmentLocationType.CLIENT) {
        throw new BadRequestException(
          `Solo se puede desinstalar un equipo que esté instalado en un cliente (estado actual: ${equipment.locationType})`,
        );
      }

      const employee = await this.validateTechnician(manager, dto.employeeId);

      return this.persistTransition(
        manager,
        equipment,
        {
          movementType: EquipmentMovementType.DESINSTALAR,
          toLocationType: EquipmentLocationType.TECHNICIAN,
          toEmployeeId: employee.id,
          conditionAfter: dto.condition ?? equipment.condition,
          reason: dto.reason,
        },
        userId,
      );
    });
  }

  async devolverAlmacen(equipmentItemId: string, userId: string, warehouseId?: string): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.lockEquipment(manager, equipmentItemId);

      if (equipment.locationType !== EquipmentLocationType.TECHNICIAN) {
        throw new BadRequestException(
          `Solo se puede devolver a almacén un equipo que esté en poder de un técnico (estado actual: ${equipment.locationType})`,
        );
      }

      const warehouse = await resolveWarehouse(manager.getRepository(WarehouseEntity), warehouseId);

      const saved = await this.persistTransition(
        manager,
        equipment,
        {
          movementType: EquipmentMovementType.DEVOLVER_A_ALMACEN,
          toLocationType: EquipmentLocationType.WAREHOUSE,
          toWarehouseId: warehouse.id,
          conditionAfter: equipment.condition,
        },
        userId,
      );

      if (USABLE_CONDITIONS.includes(saved.condition)) {
        await adjustWarehouseStock(manager, saved.productId, 1);
      }
      return saved;
    });
  }

  async transferirATecnico(
    equipmentItemId: string,
    dto: TransferTechnicianDto,
    userId: string,
  ): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.lockEquipment(manager, equipmentItemId);

      if (equipment.locationType !== EquipmentLocationType.TECHNICIAN) {
        throw new BadRequestException(
          `Solo se puede transferir entre técnicos un equipo que esté actualmente en poder de un técnico (estado actual: ${equipment.locationType})`,
        );
      }
      if (equipment.currentEmployeeId === dto.toEmployeeId) {
        throw new BadRequestException('El equipo ya se encuentra en poder de ese técnico');
      }

      const employee = await this.validateTechnician(manager, dto.toEmployeeId);

      return this.persistTransition(
        manager,
        equipment,
        {
          movementType: EquipmentMovementType.TRANSFERIR_A_OTRO_TECNICO,
          toLocationType: EquipmentLocationType.TECHNICIAN,
          toEmployeeId: employee.id,
          conditionAfter: equipment.condition,
          notes: dto.notes,
        },
        userId,
      );
    });
  }

  async reportarDano(equipmentItemId: string, dto: ReportDamageDto, userId: string): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.lockEquipment(manager, equipmentItemId);

      if ([EquipmentLocationType.RETIRED, EquipmentLocationType.LOST].includes(equipment.locationType)) {
        throw new BadRequestException('No se puede reportar daño en un equipo dado de baja o perdido');
      }

      const wasUsableInWarehouse =
        equipment.locationType === EquipmentLocationType.WAREHOUSE && USABLE_CONDITIONS.includes(equipment.condition);

      const saved = await this.persistTransition(
        manager,
        equipment,
        {
          movementType: EquipmentMovementType.REPORTAR_DANO,
          toLocationType: equipment.locationType,
          toWarehouseId: equipment.currentWarehouseId,
          toEmployeeId: equipment.currentEmployeeId,
          toClientId: equipment.clientId,
          toContractId: equipment.currentContractId,
          conditionAfter: dto.condition,
          reason: dto.reason,
        },
        userId,
      );

      if (wasUsableInWarehouse) {
        await adjustWarehouseStock(manager, saved.productId, -1);
      }
      return saved;
    });
  }

  async enviarAReparacion(equipmentItemId: string, dto: SendToRepairDto, userId: string): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.lockEquipment(manager, equipmentItemId);

      if (![EquipmentLocationType.WAREHOUSE, EquipmentLocationType.TECHNICIAN].includes(equipment.locationType)) {
        throw new BadRequestException(
          `Solo se puede enviar a reparación un equipo que esté en almacén o con un técnico (estado actual: ${equipment.locationType})`,
        );
      }
      if (![EquipmentCondition.DAMAGED, EquipmentCondition.DEFECTIVE].includes(equipment.condition)) {
        throw new BadRequestException(
          `Solo se pueden enviar a reparación equipos dañados o defectuosos (condición actual: ${equipment.condition})`,
        );
      }

      // DAMAGED/DEFECTIVE nunca cuentan como stock disponible, por lo que enviar a
      // reparación no modifica stockCurrent sin importar de dónde provenga el equipo.
      return this.persistTransition(
        manager,
        equipment,
        {
          movementType: EquipmentMovementType.ENVIAR_A_REPARACION,
          toLocationType: EquipmentLocationType.REPAIR_VENDOR,
          conditionAfter: EquipmentCondition.IN_REPAIR,
          reason: dto.reason,
          notes: dto.vendorName ? `Proveedor: ${dto.vendorName}` : undefined,
        },
        userId,
      );
    });
  }

  async retornarDeReparacion(
    equipmentItemId: string,
    dto: ReturnFromRepairDto,
    userId: string,
  ): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.lockEquipment(manager, equipmentItemId);

      if (equipment.locationType !== EquipmentLocationType.REPAIR_VENDOR) {
        throw new BadRequestException(
          `Solo se puede retornar de reparación un equipo que esté con un proveedor de reparación (estado actual: ${equipment.locationType})`,
        );
      }

      if (dto.repaired) {
        const warehouse = await resolveWarehouse(manager.getRepository(WarehouseEntity), dto.warehouseId);
        const saved = await this.persistTransition(
          manager,
          equipment,
          {
            movementType: EquipmentMovementType.RETORNAR_DE_REPARACION,
            toLocationType: EquipmentLocationType.WAREHOUSE,
            toWarehouseId: warehouse.id,
            conditionAfter: EquipmentCondition.GOOD,
            notes: dto.notes,
          },
          userId,
        );
        await adjustWarehouseStock(manager, saved.productId, 1);
        return saved;
      }

      return this.persistTransition(
        manager,
        equipment,
        {
          movementType: EquipmentMovementType.RETORNAR_DE_REPARACION,
          toLocationType: EquipmentLocationType.RETIRED,
          conditionAfter: EquipmentCondition.SCRAPPED,
          reason: 'Equipo dictaminado no reparable por el proveedor',
          notes: dto.notes,
        },
        userId,
      );
    });
  }

  async darDeBaja(equipmentItemId: string, dto: RetireEquipmentDto, userId: string): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.lockEquipment(manager, equipmentItemId);

      if (equipment.locationType === EquipmentLocationType.CLIENT) {
        throw new BadRequestException('No se puede dar de baja un equipo instalado en un cliente; desinstálelo primero');
      }
      if ([EquipmentLocationType.RETIRED, EquipmentLocationType.LOST].includes(equipment.locationType)) {
        throw new BadRequestException('El equipo ya se encuentra dado de baja');
      }

      const wasUsableInWarehouse =
        equipment.locationType === EquipmentLocationType.WAREHOUSE && USABLE_CONDITIONS.includes(equipment.condition);

      const saved = await this.persistTransition(
        manager,
        equipment,
        {
          movementType: EquipmentMovementType.DAR_DE_BAJA,
          toLocationType: dto.lost ? EquipmentLocationType.LOST : EquipmentLocationType.RETIRED,
          conditionAfter: EquipmentCondition.SCRAPPED,
          reason: dto.reason,
        },
        userId,
      );

      if (wasUsableInWarehouse) {
        await adjustWarehouseStock(manager, saved.productId, -1);
      }
      return saved;
    });
  }

  async ajusteEquipo(equipmentItemId: string, dto: AdjustEquipmentDto, userId: string): Promise<SerialNumberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.lockEquipment(manager, equipmentItemId);

      const wasUsableInWarehouse =
        equipment.locationType === EquipmentLocationType.WAREHOUSE && USABLE_CONDITIONS.includes(equipment.condition);
      const willBeUsableInWarehouse =
        dto.locationType === EquipmentLocationType.WAREHOUSE && USABLE_CONDITIONS.includes(dto.condition);

      let warehouseId: string | undefined;
      if (dto.locationType === EquipmentLocationType.WAREHOUSE) {
        const warehouse = await resolveWarehouse(manager.getRepository(WarehouseEntity), dto.warehouseId);
        warehouseId = warehouse.id;
      }
      if (dto.locationType === EquipmentLocationType.TECHNICIAN && !dto.employeeId) {
        throw new BadRequestException('Debe especificar employeeId cuando la ubicación de ajuste es TECHNICIAN');
      }
      if (dto.locationType === EquipmentLocationType.CLIENT && !dto.clientId) {
        throw new BadRequestException('Debe especificar clientId cuando la ubicación de ajuste es CLIENT');
      }
      if (dto.employeeId) {
        await this.validateTechnician(manager, dto.employeeId);
      }

      const saved = await this.persistTransition(
        manager,
        equipment,
        {
          movementType: EquipmentMovementType.AJUSTE_CONTEO_FISICO,
          toLocationType: dto.locationType,
          toWarehouseId: warehouseId,
          toEmployeeId: dto.employeeId,
          toClientId: dto.clientId,
          toContractId: dto.contractId,
          conditionAfter: dto.condition,
          reason: dto.reason,
        },
        userId,
      );

      if (wasUsableInWarehouse !== willBeUsableInWarehouse) {
        await adjustWarehouseStock(manager, saved.productId, willBeUsableInWarehouse ? 1 : -1);
      }
      return saved;
    });
  }

  async getKardex(equipmentItemId: string, paginationDto: PaginationDto) {
    const page = paginationDto.page || 1;
    const limit = paginationDto.limit || 20;
    const skip = (page - 1) * limit;

    const equipment = await this.serialRepository.findOneBy({ id: equipmentItemId });
    if (!equipment) {
      throw new NotFoundException(`Equipo con ID ${equipmentItemId} no encontrado`);
    }

    const [data, total] = await this.movementRepository.findAndCount({
      where: { equipmentItemId },
      relations: ['performedByUser', 'ticket'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findEquipment(filter: FilterSerialDto) {
    const page = filter.page || 1;
    const limit = filter.limit || 10;
    const skip = (page - 1) * limit;

    const query = this.serialRepository
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.product', 'product')
      .leftJoinAndSelect('s.client', 'client')
      .leftJoinAndSelect('s.currentEmployee', 'employee')
      .leftJoinAndSelect('employee.user', 'employeeUser')
      .leftJoinAndSelect('s.currentWarehouse', 'warehouse')
      .skip(skip)
      .take(limit);

    if (filter.productId) query.andWhere('s.productId = :productId', { productId: filter.productId });
    if (filter.locationType) query.andWhere('s.locationType = :locationType', { locationType: filter.locationType });
    if (filter.condition) query.andWhere('s.condition = :condition', { condition: filter.condition });
    if (filter.employeeId) query.andWhere('s.currentEmployeeId = :employeeId', { employeeId: filter.employeeId });
    if (filter.clientId) query.andWhere('s.clientId = :clientId', { clientId: filter.clientId });
    if (filter.status) query.andWhere('s.status = :status', { status: filter.status });
    if (filter.search) {
      query.andWhere('(s.serialNumber ILIKE :search OR s.macAddress ILIKE :search)', {
        search: `%${filter.search}%`,
      });
    }

    const [data, total] = await query.orderBy('s.serialNumber', 'ASC').getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(equipmentItemId: string): Promise<SerialNumberEntity> {
    const equipment = await this.serialRepository.findOne({
      where: { id: equipmentItemId },
      relations: ['product', 'client', 'currentEmployee', 'currentEmployee.user', 'currentWarehouse'],
    });
    if (!equipment) {
      throw new NotFoundException(`Equipo con ID ${equipmentItemId} no encontrado`);
    }
    return equipment;
  }

  async getTechnicianEquipment(employeeId: string): Promise<SerialNumberEntity[]> {
    return this.serialRepository.find({
      where: { currentEmployeeId: employeeId, locationType: EquipmentLocationType.TECHNICIAN },
      relations: ['product'],
      order: { serialNumber: 'ASC' },
    });
  }

  private async lockEquipment(manager: EntityManager, equipmentItemId: string): Promise<SerialNumberEntity> {
    const equipment = await manager.getRepository(SerialNumberEntity).findOne({
      where: { id: equipmentItemId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!equipment) {
      throw new NotFoundException(`Equipo con ID ${equipmentItemId} no encontrado`);
    }
    return equipment;
  }

  private async validateTechnician(manager: EntityManager, employeeId: string): Promise<EmployeeEntity> {
    const employee = await manager.getRepository(EmployeeEntity).findOne({
      where: { id: employeeId },
      relations: ['user', 'user.roles'],
    });
    if (!employee) {
      throw new NotFoundException(`Empleado ${employeeId} no encontrado`);
    }
    if (!employee.isActive) {
      throw new BadRequestException(`El empleado con cédula ${employee.cedula} no está activo`);
    }
    const isTechnician = employee.user?.roles?.some((role) => role.name === Role.TECNICO);
    if (!isTechnician) {
      throw new BadRequestException('El empleado indicado no tiene asignado el rol de Técnico');
    }
    return employee;
  }

  private async persistTransition(
    manager: EntityManager,
    equipment: SerialNumberEntity,
    changes: TransitionChanges,
    userId: string,
  ): Promise<SerialNumberEntity> {
    const serialRepo = manager.getRepository(SerialNumberEntity);
    const movementRepo = manager.getRepository(EquipmentMovementEntity);

    const fromLocationType = equipment.locationType;
    const fromWarehouseId = equipment.currentWarehouseId;
    const fromEmployeeId = equipment.currentEmployeeId;
    const fromClientId = equipment.clientId;
    const fromContractId = equipment.currentContractId;
    const conditionBefore = equipment.condition;

    equipment.locationType = changes.toLocationType;
    // Se usa `?? null` (no `undefined`): TypeORM omite del UPDATE cualquier
    // columna en `undefined`, lo que dejaría IDs de custodia previos "fantasma".
    equipment.currentWarehouseId = changes.toWarehouseId ?? null;
    equipment.currentEmployeeId = changes.toEmployeeId ?? null;
    equipment.clientId = changes.toClientId ?? null;
    equipment.currentContractId = changes.toContractId ?? null;
    equipment.condition = changes.conditionAfter;
    equipment.status = deriveLegacyStatus(changes.toLocationType, changes.conditionAfter);
    equipment.lastMovementAt = new Date();
    if (changes.toClientId) {
      equipment.assignedAt = new Date();
    }
    if (changes.notes) {
      equipment.notes = changes.notes;
    }

    const saved = await serialRepo.save(equipment);

    await movementRepo.save(
      movementRepo.create({
        equipmentItemId: saved.id,
        movementType: changes.movementType,
        fromLocationType,
        fromWarehouseId,
        fromEmployeeId,
        fromClientId,
        fromContractId,
        toLocationType: changes.toLocationType,
        toWarehouseId: changes.toWarehouseId,
        toEmployeeId: changes.toEmployeeId,
        toClientId: changes.toClientId,
        toContractId: changes.toContractId,
        conditionBefore,
        conditionAfter: changes.conditionAfter,
        ticketId: changes.ticketId,
        performedByUserId: userId,
        reason: changes.reason,
        notes: changes.notes,
      }),
    );

    return saved;
  }
}
