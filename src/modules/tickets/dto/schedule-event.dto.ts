import { 
  IsNotEmpty, 
  IsString, 
  IsOptional, 
  IsEnum, 
  IsUUID, 
  IsBoolean, 
  IsInt, 
  Min, 
  Max, 
  Matches 
} from 'class-validator';
import { ScheduleEventType, ScheduleEventScope } from '../entities/schedule-event.entity';

export class CreateScheduleEventDto {
  @IsNotEmpty({ message: 'El título del evento es obligatorio' })
  @IsString({ message: 'El título debe ser una cadena de texto' })
  title: string;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  description?: string;

  @IsNotEmpty({ message: 'El tipo de evento es obligatorio' })
  @IsEnum(['REUNION', 'FECHA_PAGO', 'AVISO_GLOBAL', 'MANTENIMIENTO_RED', 'CAPACITACION'], {
    message: 'Tipo de evento inválido',
  })
  type: ScheduleEventType;

  @IsNotEmpty({ message: 'El alcance del evento es obligatorio' })
  @IsEnum(['GLOBAL', 'DEPARTMENT', 'EMPLOYEE'], {
    message: 'Alcance inválido (GLOBAL, DEPARTMENT, EMPLOYEE)',
  })
  scope: ScheduleEventScope;

  @IsOptional()
  @IsUUID('4', { message: 'El ID de empleado debe ser un UUID válido' })
  assignedEmployeeId?: string;

  @IsNotEmpty({ message: 'La fecha del evento es obligatoria' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha debe tener formato YYYY-MM-DD' })
  eventDate: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'La hora de inicio debe tener formato HH:mm (24h)' })
  startTime?: string;

  @IsOptional()
  @IsInt({ message: 'La duración debe ser un número entero de minutos' })
  @Min(15, { message: 'La duración mínima es de 15 minutos' })
  @Max(720, { message: 'La duración máxima es de 720 minutos (12 horas)' })
  durationMinutes?: number;

  @IsOptional()
  @IsBoolean({ message: 'isAllDay debe ser un valor booleano' })
  isAllDay?: boolean;

  @IsOptional()
  @IsString()
  color?: string;
}

export class UpdateScheduleEventDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['REUNION', 'FECHA_PAGO', 'AVISO_GLOBAL', 'MANTENIMIENTO_RED', 'CAPACITACION'])
  type?: ScheduleEventType;

  @IsOptional()
  @IsEnum(['GLOBAL', 'DEPARTMENT', 'EMPLOYEE'])
  scope?: ScheduleEventScope;

  @IsOptional()
  @IsUUID('4')
  assignedEmployeeId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  eventDate?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  durationMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;

  @IsOptional()
  @IsString()
  color?: string;
}

export class FilterScheduleEventsDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  @IsEnum(['REUNION', 'FECHA_PAGO', 'AVISO_GLOBAL', 'MANTENIMIENTO_RED', 'CAPACITACION'])
  type?: ScheduleEventType;

  @IsOptional()
  @IsEnum(['GLOBAL', 'DEPARTMENT', 'EMPLOYEE'])
  scope?: ScheduleEventScope;

  @IsOptional()
  @IsUUID('4')
  assignedEmployeeId?: string;
}
