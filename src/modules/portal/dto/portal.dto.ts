import { IsNotEmpty, IsString, IsNumber, IsPositive, IsOptional, IsUUID, IsDateString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Enviado como multipart/form-data junto al archivo del comprobante
 * (`receiptFile`, ver PortalController.submitDepositProof), no como JSON —
 * por eso `amount` viaja como string y se transforma a número con @Type.
 * Ya no acepta `receiptUrl`: el comprobante debe ser siempre un archivo real
 * subido a MinIO, nunca un link de texto libre.
 */
export class UploadDepositProofDto {
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsNotEmpty({ message: 'El nombre del banco es requerido' })
  @IsString()
  bankName: string;

  @IsNotEmpty({ message: 'El número de referencia o confirmación es requerido' })
  @IsString()
  referenceNumber: string;

  @IsNotEmpty({ message: 'El monto depositado es requerido' })
  @Type(() => Number)
  @IsNumber()
  @IsPositive({ message: 'El monto debe ser positivo' })
  amount: number;

  @IsNotEmpty({ message: 'La fecha del depósito es requerida' })
  @IsDateString()
  depositDate: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePlanChangeRequestDto {
  @IsNotEmpty({ message: 'El ID del contrato es requerido' })
  @IsUUID()
  contractId: string;

  @IsNotEmpty({ message: 'El plan solicitado es requerido' })
  @IsUUID()
  requestedPlanId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class PortalChatMessageDto {
  @IsNotEmpty({ message: 'El mensaje no puede estar vacío' })
  @IsString()
  message: string;

  @IsOptional()
  @IsUUID()
  contractId?: string;
}

export class ConvertChatToTicketDto {
  @IsNotEmpty({ message: 'El ID del contrato es requerido' })
  @IsUUID()
  contractId: string;

  @IsNotEmpty({ message: 'La descripción de la avería es requerida' })
  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  chatSummary?: string;

  @IsOptional()
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/**
 * Filtro para GET /portal/tickets. `contractId` es opcional: sin él, se listan
 * todos los tickets del cliente autenticado (todas sus direcciones/contratos).
 */
export class FilterPortalTicketDto extends PaginationDto {
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED'])
  status?: 'OPEN' | 'IN_PROGRESS' | 'ON_HOLD' | 'RESOLVED' | 'CLOSED';

  @IsOptional()
  @IsUUID()
  contractId?: string;
}
