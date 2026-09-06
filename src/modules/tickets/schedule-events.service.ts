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
   * Obtiene la lista de eventos y avisos de oficina según filtros de fecha y alcance,
   * expandiendo virtualmente los eventos recurrentes (ej. cobros los 25 de cada mes).
   */
  async findAll(filterDto: FilterScheduleEventsDto): Promise<ScheduleEventEntity[]> {
    // 1. Consultar eventos directos (no recurrentes o que caigan en el rango)
    const query = this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.assignedEmployee', 'employee')
      .leftJoinAndSelect('employee.user', 'employeeUser')
      .leftJoinAndSelect('event.createdByUser', 'creator')
      .orderBy('event.eventDate', 'ASC')
      .addOrderBy('event.startTime', 'ASC', 'NULLS FIRST');

    if (filterDto.startDate && filterDto.endDate) {
      query.andWhere(
        '( (event.isRecurring = false AND event.eventDate BETWEEN :startDate AND :endDate) OR (event.isRecurring = true) )',
        { startDate: filterDto.startDate, endDate: filterDto.endDate }
      );
    } else if (filterDto.startDate) {
      query.andWhere(
        '( (event.isRecurring = false AND event.eventDate >= :startDate) OR (event.isRecurring = true) )',
        { startDate: filterDto.startDate }
      );
    } else if (filterDto.endDate) {
      query.andWhere(
        '( (event.isRecurring = false AND event.eventDate <= :endDate) OR (event.isRecurring = true) )',
        { endDate: filterDto.endDate }
      );
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

    const allEvents = await query.getMany();

    // 2. Si no hay rango de fechas, devolver directo
    if (!filterDto.startDate || !filterDto.endDate) {
      return allEvents;
    }

    // 3. Expansión virtual de ocurrencias recurrentes dentro del rango [startDate, endDate]
    const start = new Date(`${filterDto.startDate}T00:00:00Z`);
    const end = new Date(`${filterDto.endDate}T23:59:59Z`);
    const resultEvents: ScheduleEventEntity[] = [];

    for (const ev of allEvents) {
      if (!ev.isRecurring || ev.recurrenceType === 'NONE') {
        resultEvents.push(ev);
        continue;
      }

      // Expansión mensual por día del mes (ej. día 25)
      if (ev.recurrenceType === 'MONTHLY_DAY' && ev.recurrenceDay) {
        const targetDay = ev.recurrenceDay;
        // Iterar los meses comprendidos entre start y end
        const currentMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
        const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

        while (currentMonth <= endMonth) {
          const year = currentMonth.getUTCFullYear();
          const month = currentMonth.getUTCMonth(); // 0..11
          
          // Calcular el número máximo de días del mes
          const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
          const day = Math.min(targetDay, daysInMonth);
          const occurrenceDate = new Date(Date.UTC(year, month, day));

          if (occurrenceDate >= start && occurrenceDate <= end) {
            const formattedIso = occurrenceDate.toISOString().split('T')[0];
            // Clonar evento virtual con la fecha expandida
            const virtualInstance: ScheduleEventEntity = {
              ...ev,
              id: `${ev.id}-rec-${formattedIso}`,
              eventDate: formattedIso,
            };
            resultEvents.push(virtualInstance);
          }

          // Avanzar al siguiente mes
          currentMonth.setUTCMonth(currentMonth.getUTCMonth() + 1);
        }
      } else {
        // Para otros tipos de recurrencia o respaldo, incluir la ocurrencia base si entra en el rango
        if (ev.eventDate >= filterDto.startDate && ev.eventDate <= filterDto.endDate) {
          resultEvents.push(ev);
        }
      }
    }

    // Ordenar cronológicamente
    return resultEvents.sort((a, b) => {
      if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
      const aTime = a.startTime || '00:00';
      const bTime = b.startTime || '00:00';
      return aTime.localeCompare(bTime);
    });
  }

  /**
   * Busca un evento específico por su identificador UUID.
   */
  async findById(id: string): Promise<ScheduleEventEntity> {
    const cleanId = id.split('-rec-')[0]; // En caso de ID virtual recurrente
    const event = await this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.assignedEmployee', 'employee')
      .leftJoinAndSelect('employee.user', 'employeeUser')
      .leftJoinAndSelect('event.createdByUser', 'creator')
      .where('event.id = :id', { id: cleanId })
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

    const isRecurring = dto.isRecurring || false;
    const recurrenceType = isRecurring ? (dto.recurrenceType || 'NONE') : 'NONE';
    let recurrenceDay = dto.recurrenceDay;
    
    if (isRecurring && recurrenceType === 'MONTHLY_DAY' && !recurrenceDay) {
      const parts = dto.eventDate.split('-');
      recurrenceDay = parts.length === 3 ? parseInt(parts[2], 10) : 25;
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
      isRecurring,
      recurrenceType,
      recurrenceDay: isRecurring ? recurrenceDay : null,
      isHardBlock: dto.isHardBlock || false,
      isLocked: dto.isLocked || false,
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

    if (event.isLocked && dto.isLocked === undefined) {
      // Si el evento está bloqueado, se permite actualizar sólo si se incluye explícitamente desbloqueo
    }

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
    if (dto.isRecurring !== undefined) {
      event.isRecurring = dto.isRecurring;
    }
    if (dto.recurrenceType !== undefined) {
      event.recurrenceType = dto.recurrenceType;
    }
    if (dto.recurrenceDay !== undefined) {
      event.recurrenceDay = dto.recurrenceDay;
    }
    if (dto.isHardBlock !== undefined) {
      event.isHardBlock = dto.isHardBlock;
    }
    if (dto.isLocked !== undefined) {
      event.isLocked = dto.isLocked;
    }

    await this.eventRepository.save(event);
    return this.findById(id);
  }

  /**
   * Elimina un evento del cronograma.
   */
  async delete(id: string): Promise<{ success: boolean; message: string }> {
    const event = await this.findById(id);
    if (event.isLocked) {
      throw new BadRequestException('No se puede eliminar un hito fijo bloqueado. Desbloquéelo primero.');
    }
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
