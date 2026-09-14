import { IsNotEmpty, IsUUID, IsEnum, IsString, IsOptional, IsNumber, Min, Max, IsArray, ValidateIf } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateTicketDto {
  @IsNotEmpty()
  @IsUUID('4')
  clientId: string;

  // Una orden de Instalación siempre es consecuencia de un contrato ya
  // firmado — nunca al revés — así que el contrato es obligatorio para este
  // tipo (para los demás tipos sigue siendo opcional).
  @ValidateIf((o) => o.type === 'INSTALLATION')
  @IsNotEmpty({ message: 'Debe seleccionar el contrato de servicio para crear una orden de Instalación' })
  @IsUUID('4')
  contractId?: string;

  @IsOptional()
  @IsUUID('4')
  assignedEmployeeId?: string;

  @IsEnum(['INSTALLATION', 'REPAIR_FAULT', 'MAINTENANCE', 'DISCONNECTION'])
  type: 'INSTALLATION' | 'REPAIR_FAULT' | 'MAINTENANCE' | 'DISCONNECTION';

  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsOptional()
  @IsString()
  scheduledStart?: string;

  @IsOptional()
  estimatedDurationMinutes?: number;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  description: string;
}

export class ScheduleTicketDto {
  @IsOptional()
  @IsString()
  scheduledStart?: string;

  @IsOptional()
  estimatedDurationMinutes?: number;

  @IsOptional()
  @IsUUID('4')
  assignedEmployeeId?: string;
}

export class UpdateTicketStatusDto {
  @IsEnum(['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED'])
  status: 'OPEN' | 'IN_PROGRESS' | 'ON_HOLD' | 'RESOLVED' | 'CLOSED';

  @IsOptional()
  @IsString()
  note?: string;

  // Geolocalización obligatoria al resolver una instalación (ver
  // TicketsService.updateStatus) — no aplica a otros tipos de ticket.
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

export class SwapHardwareDto {
  @IsNotEmpty()
  @IsUUID('4')
  ticketId: string;

  @IsNotEmpty()
  @IsUUID('4')
  serialRemovedId: string;

  @IsNotEmpty()
  @IsUUID('4')
  serialInstalledId: string;

  @IsNotEmpty()
  @IsString()
  reason: string;
}

export class FilterTicketDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;

  /**
   * Filtro por múltiples estados separados por coma.
   * Ejemplo: "OPEN,IN_PROGRESS" — tiene prioridad sobre `status` si se proveen ambos.
   * Valores válidos: OPEN | IN_PROGRESS | ON_HOLD | RESOLVED | CLOSED
   */
  @IsOptional()
  @IsString()
  statuses?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  includeActiveBacklog?: boolean | string;
}

/** DTO reutilizable para el endpoint GET /tickets/count */
export class CountTicketDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  /** Filtro por múltiples estados separados por coma. */
  @IsOptional()
  @IsString()
  statuses?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

