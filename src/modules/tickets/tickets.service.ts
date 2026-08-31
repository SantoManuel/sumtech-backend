import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TicketEntity } from './entities/ticket.entity';
import { TicketHistoryEntity } from './entities/ticket-history.entity';
import { TicketRepairEntity } from './entities/ticket-repair.entity';
import { SlaPolicyEntity } from './entities/sla-policy.entity';
import { CreateTicketDto, UpdateTicketStatusDto, SwapHardwareDto, ScheduleTicketDto } from './dto/ticket.dto';
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
    private readonly equipmentMovementService: EquipmentMovementService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(paginationDto: PaginationDto, status?: string, type?: string, employeeId?: string) {
    const page = paginationDto.page || 1;
    const limit = paginationDto.limit || 15;
    const skip = (page - 1) * limit;

    const query = this.ticketRepository
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.client', 'client')
      .leftJoinAndSelect('ticket.contract', 'contract')
      .leftJoinAndSelect('contract.plan', 'plan')
      .leftJoinAndSelect('contract.address', 'address')
      .leftJoinAndSelect('ticket.assignedEmployee', 'employee')
      .leftJoinAndSelect('employee.user', 'user')
      .skip(skip)
      .take(limit)
      .orderBy('ticket.createdAt', 'DESC');

    if (status) query.andWhere('ticket.status = :status', { status });
    if (type) query.andWhere('ticket.type = :type', { type });
    if (employeeId) query.andWhere('ticket.assignedEmployeeId = :employeeId', { employeeId });

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
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

  async createInstallationFromSale(clientId: string, ncfNumber: string): Promise<TicketEntity> {
    return this.create({
      clientId,
      type: 'INSTALLATION',
      priority: 'HIGH',
      title: `Instalación de Servicio por Venta (${ncfNumber})`,
      description: `Orden generada automáticamente tras la confirmación de la venta con comprobante fiscal ${ncfNumber}. Despachar técnico para instalación de fibra óptica y equipos.`,
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
}

