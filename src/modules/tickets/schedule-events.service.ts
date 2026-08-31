import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { ScheduleEventEntity } from './entities/schedule-event.entity';
import { 
  CreateScheduleEventDto, 
  UpdateScheduleEventDto, 
  FilterScheduleEventsDto 
} from './dto/schedule-event.dto';

@Injectable()
export class ScheduleEventsService {
  constructor(
    @InjectRepository(ScheduleEventEntity)
    private readonly eventRepository: Repository<ScheduleEventEntity>,
  ) {}

  /**
   * Obtiene la lista de eventos y avisos de oficina según filtros de fecha y alcance.
   */
  async findAll(filterDto: FilterScheduleEventsDto): Promise<ScheduleEventEntity[]> {
    const query = this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.assignedEmployee', 'employee')
      .leftJoinAndSelect('employee.user', 'employeeUser')
      .leftJoinAndSelect('event.createdByUser', 'creator')
      .orderBy('event.eventDate', 'ASC')
      .addOrderBy('event.startTime', 'ASC', 'NULLS FIRST');

    if (filterDto.startDate && filterDto.endDate) {
      query.andWhere('event.eventDate BETWEEN :startDate AND :endDate', {
        startDate: filterDto.startDate,
        endDate: filterDto.endDate,
      });
    } else if (filterDto.startDate) {
      query.andWhere('event.eventDate >= :startDate', { startDate: filterDto.startDate });
    } else if (filterDto.endDate) {
      query.andWhere('event.eventDate <= :endDate', { endDate: filterDto.endDate });
    }

    if (filterDto.type) {
      query.andWhere('event.type = :type', { type: filterDto.type });
    }

    if (filterDto.scope) {
      query.andWhere('event.scope = :scope', { scope: filterDto.scope });
    }

    if (filterDto.assignedEmployeeId) {
      query.andWhere(
        '(event.assignedEmployeeId = :employeeId OR event.scope = :globalScope)',
        { employeeId: filterDto.assignedEmployeeId, globalScope: 'GLOBAL' }
      );
    }

    return query.getMany();
  }

  /**
   * Busca un evento específico por su identificador UUID.
   */
  async findById(id: string): Promise<ScheduleEventEntity> {
    const event = await this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.assignedEmployee', 'employee')
      .leftJoinAndSelect('employee.user', 'employeeUser')
      .leftJoinAndSelect('event.createdByUser', 'creator')
      .where('event.id = :id', { id })
      .getOne();

    if (!event) {
      throw new NotFoundException(`Actividad/Evento con ID ${id} no encontrado`);
    }

    return event;
  }

  /**
   * Crea una nueva actividad, fecha clave o aviso de oficina.
   */
  async create(userId: string, dto: CreateScheduleEventDto): Promise<ScheduleEventEntity> {
    // Validaciones de congruencia
    if (dto.scope === 'EMPLOYEE' && !dto.assignedEmployeeId) {
      throw new BadRequestException('Para eventos con alcance de empleado, debe especificar el técnico asignado');
    }

    const event = this.eventRepository.create({
      title: dto.title.trim(),
      description: dto.description?.trim(),
      type: dto.type,
      scope: dto.scope,
      assignedEmployeeId: dto.scope === 'EMPLOYEE' ? dto.assignedEmployeeId : undefined,
      eventDate: dto.eventDate,
      startTime: dto.isAllDay ? undefined : dto.startTime || '08:00',
      durationMinutes: dto.isAllDay ? 600 : (dto.durationMinutes || 60),
      isAllDay: dto.isAllDay || false,
      color: dto.color || this.getDefaultColorForType(dto.type),
      createdByUserId: userId,
    });

    const saved = await this.eventRepository.save(event);
    return this.findById(saved.id);
  }

  /**
   * Actualiza una actividad o aviso existente.
   */
  async update(id: string, dto: UpdateScheduleEventDto): Promise<ScheduleEventEntity> {
    const event = await this.findById(id);

    if (dto.title !== undefined) event.title = dto.title.trim();
    if (dto.description !== undefined) event.description = dto.description?.trim();
    if (dto.type !== undefined) event.type = dto.type;
    if (dto.scope !== undefined) {
      event.scope = dto.scope;
      if (dto.scope !== 'EMPLOYEE') {
        event.assignedEmployeeId = undefined as any;
      }
    }
    if (dto.assignedEmployeeId !== undefined) {
      event.assignedEmployeeId = dto.assignedEmployeeId || (null as any);
    }
    if (dto.eventDate !== undefined) event.eventDate = dto.eventDate;
    if (dto.isAllDay !== undefined) {
      event.isAllDay = dto.isAllDay;
      if (dto.isAllDay) {
        event.startTime = undefined as any;
      }
    }
    if (dto.startTime !== undefined && !event.isAllDay) {
      event.startTime = dto.startTime;
    }
    if (dto.durationMinutes !== undefined) {
      event.durationMinutes = dto.durationMinutes;
    }
    if (dto.color !== undefined) {
      event.color = dto.color;
    }

    await this.eventRepository.save(event);
    return this.findById(id);
  }

  /**
   * Elimina un evento del cronograma.
   */
  async delete(id: string): Promise<{ success: boolean; message: string }> {
    const event = await this.findById(id);
    await this.eventRepository.remove(event);
    return { success: true, message: `Actividad "${event.title}" eliminada exitosamente` };
  }

  /**
   * Asigna un color distintivo según el tipo de actividad.
   */
  private getDefaultColorForType(type: string): string {
    switch (type) {
      case 'FECHA_PAGO':
        return 'amber';
      case 'AVISO_GLOBAL':
        return 'cyan';
      case 'REUNION':
        return 'purple';
      case 'MANTENIMIENTO_RED':
        return 'orange';
      case 'CAPACITACION':
        return 'emerald';
      default:
        return 'blue';
    }
  }
}
