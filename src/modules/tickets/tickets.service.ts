import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TicketEntity } from './entities/ticket.entity';
import { TicketHistoryEntity } from './entities/ticket-history.entity';
import { TicketRepairEntity } from './entities/ticket-repair.entity';
import { SlaPolicyEntity } from './entities/sla-policy.entity';
import { AddressEntity } from '../clients/entities/address.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { CreateTicketDto, UpdateTicketStatusDto, SwapHardwareDto, ScheduleTicketDto, FilterTicketDto, CountTicketDto } from './dto/ticket.dto';
import { PivotScheduleDto } from './dto/pivot-schedule.dto';
import { EquipmentMovementService } from '../inventory/services/equipment-movement.service';
import { EquipmentLocationType, EquipmentCondition } from '../inventory/enums/equipment.enums';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { TicketResolvedEvent } from './events/ticket-resolved.event';

@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(TicketEntity)
    private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(TicketHistoryEntity)
    private readonly historyRepository: Repository<TicketHistoryEntity>,
    @InjectRepository(TicketRepairEntity)
    private readonly repairRepository: Repository<TicketRepairEntity>,
    @InjectRepository(SlaPolicyEntity)
    private readonly slaRepository: Repository<SlaPolicyEntity>,
    @InjectRepository(AddressEntity)
    private readonly addressRepository: Repository<AddressEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    private readonly equipmentMovementService: EquipmentMovementService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(filterDto: FilterTicketDto) {
    const page = filterDto.page || 1;
    const limit = filterDto.limit || 100;
    const skip = (page - 1) * limit;

    const query = this.ticketRepository
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.client', 'client')
      .leftJoinAndSelect('ticket.contract', 'contract')
      .leftJoinAndSelect('contract.plan', 'plan')
      .leftJoinAndSelect('contract.address', 'address')
      .leftJoinAndSelect('ticket.assignedEmployee', 'employee')
      .leftJoinAndSelect('employee.user', 'user')
      .orderBy('ticket.createdAt', 'DESC');

    if (filterDto.type && filterDto.type !== 'ALL') {
      query.andWhere('ticket.type = :type', { type: filterDto.type });
    }
    if (filterDto.employeeId) {
      query.andWhere('ticket.assignedEmployeeId = :employeeId', { employeeId: filterDto.employeeId });
    }
    if (filterDto.clientId) {
      query.andWhere('ticket.clientId = :clientId', { clientId: filterDto.clientId });
    }

    const includeActive = filterDto.includeActiveBacklog === true || filterDto.includeActiveBacklog === 'true';

    // `statuses` (coma-separados) tiene prioridad sobre `status` (valor singular)
    const statusList = filterDto.statuses
      ? filterDto.statuses.split(',').map((s) => s.trim()).filter(Boolean)
      : null;

    if (statusList && statusList.length > 0) {
      // Filtrado multi-estado server-side — usado por las tabs del portal técnico
      query.andWhere('ticket.status IN (:...statusList)', { statusList });
      if (filterDto.startDate) {
        query.andWhere('ticket.createdAt >= :startDate', { startDate: new Date(filterDto.startDate) });
      }
      if (filterDto.endDate) {
        query.andWhere('ticket.createdAt <= :endDate', { endDate: new Date(filterDto.endDate) });
      }
    } else if (filterDto.status) {
      query.andWhere('ticket.status = :status', { status: filterDto.status });
      if (filterDto.startDate) {
        query.andWhere('ticket.createdAt >= :startDate', { startDate: new Date(filterDto.startDate) });
      }
      if (filterDto.endDate) {
        query.andWhere('ticket.createdAt <= :endDate', { endDate: new Date(filterDto.endDate) });
      }
    } else if (filterDto.startDate || filterDto.endDate) {
      const start = filterDto.startDate ? new Date(filterDto.startDate) : new Date('2000-01-01');
      const end = filterDto.endDate ? new Date(filterDto.endDate) : new Date('2100-01-01');

      if (includeActive) {
        // Traer TODO lo pendiente/en curso + resueltos dentro de la ventana de fechas
        query.andWhere(
          '(ticket.status IN (:...activeStatuses) OR (ticket.status IN (:...closedStatuses) AND COALESCE(ticket.resolvedAt, ticket.createdAt) BETWEEN :start AND :end))',
          {
            activeStatuses: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'],
            closedStatuses: ['RESOLVED', 'CLOSED'],
            start,
            end,
          },
        );
      } else {
        query.andWhere('ticket.createdAt BETWEEN :start AND :end', { start, end });
      }
    }

    if (filterDto.limit) {
      query.skip(skip).take(limit);
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit: filterDto.limit || total, totalPages: filterDto.limit ? Math.ceil(total / limit) : 1 };
  }

  /**
   * Devuelve únicamente el total de tickets que coinciden con los filtros.
   * Endpoint ligero usado por las KPI cards del dashboard del técnico.
   */
  async count(dto: CountTicketDto): Promise<{ total: number }> {
    const query = this.ticketRepository
      .createQueryBuilder('ticket')
      .select('COUNT(ticket.id)', 'total');

    if (dto.employeeId) {
      query.andWhere('ticket.assignedEmployeeId = :employeeId', { employeeId: dto.employeeId });
    }
    if (dto.clientId) {
      query.andWhere('ticket.clientId = :clientId', { clientId: dto.clientId });
    }

    const statusList = dto.statuses
      ? dto.statuses.split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    if (statusList && statusList.length > 0) {
      query.andWhere('ticket.status IN (:...statusList)', { statusList });
    }

    if (dto.startDate) {
      query.andWhere('ticket.createdAt >= :startDate', { startDate: new Date(dto.startDate) });
    }
    if (dto.endDate) {
      query.andWhere('ticket.createdAt <= :endDate', { endDate: new Date(dto.endDate) });
    }

    const result = await query.getRawOne<{ total: string }>();
    return { total: parseInt(result?.total ?? '0', 10) };
  }

  async findById(id: string): Promise<TicketEntity> {
    const ticket = await this.ticketRepository.findOne({
      where: { id },
      relations: [
        'client',
        'client.addresses',
        'contract',
        'contract.plan',
        'contract.address',
        'assignedEmployee',
        'assignedEmployee.user',
        'history',
        'history.changedByUser',
        'repairs',
        'repairs.serialRemoved',
        'repairs.serialInstalled',
      ],
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket con ID ${id} no encontrado`);
    }
    return ticket;
  }

  async create(dto: CreateTicketDto): Promise<TicketEntity> {
    if (dto.contractId) {
      const contract = await this.contractRepository.findOneBy({ id: dto.contractId });
      if (!contract || contract.clientId !== dto.clientId) {
        throw new BadRequestException('El contrato indicado no pertenece al cliente seleccionado');
      }
    }

    const ticketNumber = `TCK-${Date.now().toString().slice(-6)}`;
    const sla = await this.slaRepository.findOneBy({ priority: dto.priority });

    const dueDate = new Date();
    if (sla) {
      dueDate.setHours(dueDate.getHours() + sla.maxResolutionHours);
    } else {
      dueDate.setHours(dueDate.getHours() + 24);
    }

    const ticket = this.ticketRepository.create({
      ticketNumber,
      clientId: dto.clientId,
      contractId: dto.contractId,
      assignedEmployeeId: dto.assignedEmployeeId,
      type: dto.type,
      priority: dto.priority,
      status: 'OPEN',
      slaPolicyId: sla?.id,
      dueDate,
      scheduledStart: dto.scheduledStart ? new Date(dto.scheduledStart) : undefined,
      estimatedDurationMinutes: dto.estimatedDurationMinutes || 60,
      title: dto.title,
      description: dto.description,
    });

    return this.ticketRepository.save(ticket);
  }

  async scheduleTicket(ticketId: string, dto: ScheduleTicketDto, userId: string): Promise<TicketEntity> {
    const ticket = await this.findById(ticketId);
    if (dto.scheduledStart !== undefined) {
      ticket.scheduledStart = dto.scheduledStart ? new Date(dto.scheduledStart) : (null as any);
    }
    if (dto.estimatedDurationMinutes !== undefined) {
      ticket.estimatedDurationMinutes = dto.estimatedDurationMinutes;
    }
    if (dto.assignedEmployeeId !== undefined) {
      ticket.assignedEmployeeId = dto.assignedEmployeeId || (null as any);
    }
    const saved = await this.ticketRepository.save(ticket);

    await this.historyRepository.save(
      this.historyRepository.create({
        ticketId: saved.id,
        previousStatus: saved.status,
        newStatus: saved.status,
        changedByUserId: userId,
        note: `CRONOGRAMA GANTT: Reprogramada para ${dto.scheduledStart ? new Date(dto.scheduledStart).toLocaleString('es-DO') : 'sin fecha programada'} (Duración: ${dto.estimatedDurationMinutes || 60} min)`,
      }),
    );

    return this.findById(ticketId);
  }

  async updateStatus(ticketId: string, userId: string, dto: UpdateTicketStatusDto): Promise<TicketEntity> {
    const ticket = await this.findById(ticketId);
    const previousStatus = ticket.status;

    // Geolocalización obligatoria al resolver una instalación: garantiza que
    // AddressEntity.gpsLatitude/gpsLongitude queden con la ubicación real del
    // cliente en el momento de la visita (nunca se escribían desde ningún
    // endpoint real antes de esto). No aplica a reparación/mantenimiento.
    if (dto.status === 'RESOLVED' && ticket.type === 'INSTALLATION') {
      if (dto.latitude === undefined || dto.longitude === undefined) {
        throw new BadRequestException(
          'Se requiere la ubicación GPS del cliente para marcar como resuelta una instalación',
        );
      }
      if (!ticket.contract?.address) {
        throw new BadRequestException(
          'El ticket no tiene una dirección de contrato asociada para guardar la ubicación',
        );
      }
      ticket.contract.address.gpsLatitude = dto.latitude;
      ticket.contract.address.gpsLongitude = dto.longitude;
      await this.addressRepository.save(ticket.contract.address);
    }

    ticket.status = dto.status;
    if (dto.status === 'RESOLVED' && !ticket.resolvedAt) {
      ticket.resolvedAt = new Date();
    }
    if (dto.status === 'CLOSED' && !ticket.closedAt) {
      ticket.closedAt = new Date();
    }

    const savedTicket = await this.ticketRepository.save(ticket);

    // Registro en historial
    await this.historyRepository.save(
      this.historyRepository.create({
        ticketId: savedTicket.id,
        previousStatus,
        newStatus: dto.status,
        changedByUserId: userId,
        note: dto.note,
      }),
    );

    // Si se resuelve la orden, disparar evento de resolución
    if (dto.status === 'RESOLVED') {
      const event: TicketResolvedEvent = {
        ticketId: savedTicket.id,
        clientId: savedTicket.clientId,
        contractId: savedTicket.contractId,
        type: savedTicket.type,
        resolvedAt: savedTicket.resolvedAt || new Date(),
      };
      this.eventEmitter.emit(SystemEvents.TICKET_RESOLVED, event);
    }

    return this.findById(ticketId);
  }

  async swapHardware(dto: SwapHardwareDto, userId: string): Promise<TicketRepairEntity> {
    const ticket = await this.findById(dto.ticketId);
    if (!ticket.assignedEmployeeId) {
      throw new BadRequestException('No se puede realizar un cambio de equipo sin un técnico asignado al ticket');
    }

    const removed = await this.equipmentMovementService.findById(dto.serialRemovedId);
    const installed = await this.equipmentMovementService.findById(dto.serialInstalledId);

    const contractId = ticket.contractId || removed.currentContractId;
    if (!contractId) {
      throw new BadRequestException(
        'No se pudo determinar el contrato del cliente para reinstalar el equipo de reemplazo',
      );
    }

    if (installed.locationType === EquipmentLocationType.WAREHOUSE) {
      await this.equipmentMovementService.asignarATecnico(
        dto.serialInstalledId,
        { employeeId: ticket.assignedEmployeeId },
        userId,
      );
    } else if (installed.locationType === EquipmentLocationType.TECHNICIAN) {
      if (installed.currentEmployeeId !== ticket.assignedEmployeeId) {
        throw new BadRequestException('El equipo de reemplazo está en poder de otro técnico');
      }
    } else {
      throw new BadRequestException(`El equipo de reemplazo no está disponible (estado: ${installed.locationType})`);
    }

    // Retira el equipo dañado del cliente (queda en poder del técnico) y coloca el
    // de reemplazo; ambos movimientos quedan en el kardex de EquipmentMovementService.
    await this.equipmentMovementService.desinstalar(
      dto.serialRemovedId,
      { employeeId: ticket.assignedEmployeeId, reason: dto.reason, condition: EquipmentCondition.DAMAGED },
      userId,
    );

    await this.equipmentMovementService.instalarEnCliente(
      dto.serialInstalledId,
      { contractId, notes: `Swap de hardware - Ticket ${ticket.ticketNumber}` },
      userId,
    );

    const repair = this.repairRepository.create({
      ticketId: dto.ticketId,
      serialRemovedId: dto.serialRemovedId,
      serialInstalledId: dto.serialInstalledId,
      reason: dto.reason,
    });

    return this.repairRepository.save(repair);
  }

  /**
   * Único punto de generación automática de un ticket de instalación (el
   * antiguo disparo desde SALE_CONFIRMED del POS se eliminó deliberadamente:
   * generaba un segundo ticket duplicado cuando, al firmar el contrato, el
   * mismo cajero facturaba de inmediato el hardware/instalación en el POS).
   * Enlaza `contractId` — necesario para que el ticket quede visible/filtrable
   * por contrato y para que, si algún día un contrato vuelve a nacer
   * PENDING_INSTALL, coordination.service.ts pueda activarlo al resolverse
   * (hoy es un despacho puramente operativo, ya que el contrato nace ACTIVE).
   */
  async createInstallationFromContract(clientId: string, contractId: string, contractNumber: string): Promise<TicketEntity> {
    return this.create({
      clientId,
      contractId,
      type: 'INSTALLATION',
      priority: 'HIGH',
      title: `Instalación de Servicio — Contrato ${contractNumber}`,
      description: `Orden generada automáticamente al firmarse el contrato ${contractNumber}. Despachar técnico para instalación de fibra óptica y equipos.`,
    });
  }

  async reassignTicket(ticketId: string, assignedEmployeeId: string, userId: string): Promise<TicketEntity> {
    const ticket = await this.findById(ticketId);
    ticket.assignedEmployeeId = assignedEmployeeId;
    const saved = await this.ticketRepository.save(ticket);

    await this.historyRepository.save(
      this.historyRepository.create({
        ticketId: saved.id,
        previousStatus: saved.status,
        newStatus: saved.status,
        changedByUserId: userId,
        note: `DESPACHO: Orden reasignada al técnico con ID ${assignedEmployeeId}`,
      }),
    );

    return this.findById(ticketId);
  }

  /**
   * Pivota (reprograma en bloque) órdenes técnicas desde una fecha origen hacia una fecha destino,
   * facilitando la liberación de cuadrillas en fechas de hitos fijos (ej. día 25 de cobro masivo).
   */
  async pivotSchedule(dto: PivotScheduleDto, userId: string): Promise<{ count: number; movedTickets: TicketEntity[] }> {
    const query = this.ticketRepository
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.assignedEmployee', 'employee')
      .leftJoinAndSelect('employee.user', 'user');

    if (dto.ticketIds && dto.ticketIds.length > 0) {
      query.where('ticket.id IN (:...ticketIds)', { ticketIds: dto.ticketIds });
    } else {
      // DATE(...) en vez de "ticket.scheduledStart::date": el reemplazo de
      // alias.propiedad -> columna real de TypeORM en condiciones crudas no
      // reconoce el límite cuando "::date" queda pegado al nombre, y el
      // identificador sin comillas llega a Postgres en minúsculas
      // ("scheduledstart"), que no existe (la columna real es snake_case).
      query.where('DATE(ticket.scheduledStart) = :sourceDate', { sourceDate: dto.sourceDate });
    }

    if (dto.technicianIds && dto.technicianIds.length > 0) {
      query.andWhere('ticket.assignedEmployeeId IN (:...technicianIds)', { technicianIds: dto.technicianIds });
    }

    const ticketsToPivot = await query.getMany();

    if (ticketsToPivot.length === 0) {
      return { count: 0, movedTickets: [] };
    }

    const movedTickets: TicketEntity[] = [];
    const [tYear, tMonth, tDay] = dto.targetDate.split('-').map(Number);

    for (const ticket of ticketsToPivot) {
      const originalDate = ticket.scheduledStart ? new Date(ticket.scheduledStart) : new Date();
      const hours = originalDate.getHours() || 8;
      const minutes = originalDate.getMinutes() || 0;

      const newScheduledStart = new Date(tYear, tMonth - 1, tDay, hours, minutes, 0);
      ticket.scheduledStart = newScheduledStart;

      const saved = await this.ticketRepository.save(ticket);
      movedTickets.push(saved);

      await this.historyRepository.save(
        this.historyRepository.create({
          ticketId: saved.id,
          previousStatus: saved.status,
          newStatus: saved.status,
          changedByUserId: userId,
          note: `GANTT PIVOT: Orden reprogramada de ${dto.sourceDate} hacia ${dto.targetDate}. ${dto.reason ? 'Motivo: ' + dto.reason : ''}`.trim(),
        }),
      );
    }

    return { count: movedTickets.length, movedTickets };
  }
}

