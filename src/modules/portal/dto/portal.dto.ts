import { IsNotEmpty, IsString, IsNumber, IsPositive, IsOptional, IsUUID, IsDateString } from 'class-validator';

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
  @IsNumber()
  @IsPositive({ message: 'El monto debe ser positivo' })
  amount: number;

  @IsNotEmpty({ message: 'La fecha del depósito es requerida' })
  @IsDateString()
  depositDate: string;

  @IsOptional()
  @IsString()
  receiptUrl?: string;

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
