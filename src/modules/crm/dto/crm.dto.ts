import { IsNotEmpty, IsString, IsOptional, IsEmail, IsEnum, IsUUID, IsNumber, Min, IsDateString, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { LEAD_SOURCE_VALUES, LeadSource } from '../enums/opportunity.enums';
import { SERVICE_INTEREST_VALUES, ServiceInterest } from '../entities/opportunity.entity';

export class CreateOpportunityDto {
  @IsNotEmpty({ message: 'El nombre del prospecto es obligatorio' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'El teléfono del prospecto es obligatorio' })
  @IsString()
  phone: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  email?: string;

  @IsOptional()
  @IsUUID('4')
  planId?: string;

  @IsOptional()
  @IsEnum(LEAD_SOURCE_VALUES)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'El valor potencial no puede ser negativo' })
  potentialValue?: number;

  @IsOptional()
  @IsEnum(SERVICE_INTEREST_VALUES)
  serviceInterest?: ServiceInterest;

  @IsOptional()
  @IsString()
  installationAddress?: string;
}

export class UpdateOpportunityDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  email?: string;

  @IsOptional()
  @IsUUID('4')
  planId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'El valor potencial no puede ser negativo' })
  potentialValue?: number;

  @IsOptional()
  @IsEnum(SERVICE_INTEREST_VALUES)
  serviceInterest?: ServiceInterest;

  @IsOptional()
  @IsString()
  installationAddress?: string;

  @IsOptional()
  @IsUUID('4')
  nextActionId?: string;

  @IsOptional()
  @IsDateString()
  nextActionDate?: string;

  @IsOptional()
  @IsUUID('4')
  assignedUserId?: string;
}

/**
 * Cambiar `subscriptionStatusId` a un estado con `code = PERDIDA` exige
 * `lossReasonId` (validado en OpportunitiesService, no aquí, porque depende
 * de resolver el código del estado destino contra el catálogo). Cambiar a
 * `SUSCRIPCION_ACTIVA` está bloqueado desde este endpoint — debe pasar por
 * `POST /crm/opportunities/:id/close`.
 */
export class UpdateOpportunityStatusDto {
  @IsNotEmpty({ message: 'El estado de suscripción es obligatorio' })
  @IsUUID('4')
  subscriptionStatusId: string;

  @IsOptional()
  @IsUUID('4')
  lossReasonId?: string;
}

export class CreateInteractionDto {
  // Al menos uno de clientId/opportunityId es obligatorio — validado en
  // CrmService.createInteraction() (depende de ambos campos a la vez, algo
  // que class-validator no expresa limpiamente a nivel de un solo campo).
  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsUUID('4')
  opportunityId?: string;

  @IsEnum(['PHONE_CALL', 'EMAIL', 'WHATSAPP', 'IN_PERSON', 'SYSTEM_EVENT'])
  channel: 'PHONE_CALL' | 'EMAIL' | 'WHATSAPP' | 'IN_PERSON' | 'SYSTEM_EVENT';

  @IsNotEmpty()
  @IsString()
  subject: string;

  @IsNotEmpty()
  @IsString()
  notes: string;
}

export class FilterOpportunityDto extends PaginationDto {
  @IsOptional()
  @IsUUID('4')
  subscriptionStatusId?: string;

  @IsOptional()
  @IsUUID('4')
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  /** Solo oportunidades cuya `nextActionDate` ya pasó (para alertas de "vencida"). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdueOnly?: boolean;
}
