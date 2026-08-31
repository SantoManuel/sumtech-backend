import { IsNotEmpty, IsUUID, IsEnum, IsString, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateTicketDto {
  @IsNotEmpty()
  @IsUUID('4')
  clientId: string;

  @IsOptional()
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

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;
}

