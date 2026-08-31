import { IsNotEmpty, IsString, IsOptional, IsEmail, IsEnum, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateLeadDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsUUID('4')
  planId?: string;

  @IsOptional()
  @IsEnum(['WEB_LANDING', 'CALL_INBOUND', 'WHATSAPP', 'FLYER'])
  source?: 'WEB_LANDING' | 'CALL_INBOUND' | 'WHATSAPP' | 'FLYER';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateInteractionDto {
  @IsNotEmpty()
  @IsUUID('4')
  clientId: string;

  @IsEnum(['PHONE_CALL', 'EMAIL', 'WHATSAPP', 'IN_PERSON', 'SYSTEM_EVENT'])
  channel: 'PHONE_CALL' | 'EMAIL' | 'WHATSAPP' | 'IN_PERSON' | 'SYSTEM_EVENT';

  @IsNotEmpty()
  @IsString()
  subject: string;

  @IsNotEmpty()
  @IsString()
  notes: string;
}

export class FilterLeadDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string;
}

