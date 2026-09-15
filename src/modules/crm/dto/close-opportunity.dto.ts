import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateAddressDto } from '../../clients/dto/create-client.dto';

/**
 * Payload de `POST /crm/opportunities/:id/close` — el único punto de entrada
 * para pasar una Opportunity a SUSCRIPCION_ACTIVA. Crea el Client real (con
 * cédula/RNC, que hasta este momento el prospecto no tenía capturado) y el
 * Contract del plan elegido; el ticket de instalación sale automático vía
 * ContractCreatedListener, no hay que pedirlo aquí.
 */
export class CloseOpportunityDto {
  @IsEnum(['CEDULA', 'RNC', 'PASAPORTE'])
  docType: 'CEDULA' | 'RNC' | 'PASAPORTE';

  @IsNotEmpty({ message: 'El número de documento es obligatorio' })
  @IsString()
  docNumber: string;

  @IsEnum(['FISICA', 'JURIDICA'])
  clientType: 'FISICA' | 'JURIDICA';

  // Si no se manda, se usan email/phone ya capturados en la Opportunity.
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @ValidateNested()
  @Type(() => CreateAddressDto)
  address: CreateAddressDto;

  // Si no se manda, se usa Opportunity.planId — si tampoco existe, el service rechaza con 400.
  @IsOptional()
  @IsUUID('4')
  planId?: string;

  @IsOptional()
  billingDay?: number;
}
