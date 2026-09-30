import { 
  IsArray, 
  ArrayNotEmpty, 
  IsUUID, 
  IsEnum, 
  IsOptional, 
  IsNumber, 
  IsString, 
  IsBoolean, 
  ValidateNested, 
  Min, 
  Max, 
  IsNotEmpty 
} from 'class-validator';
import { Type } from 'class-transformer';

export class InvoiceDiscountDto {
  @IsNotEmpty({ message: 'El ID de la factura a descontar es requerido' })
  @IsUUID('4')
  invoiceId: string;

  @IsOptional()
  @IsEnum(['FIXED', 'PERCENTAGE'])
  type?: 'FIXED' | 'PERCENTAGE';

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage?: number;

  @IsNotEmpty({ message: 'El motivo del descuento es obligatorio' })
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  supervisorEmail?: string;

  @IsOptional()
  @IsString()
  supervisorPassword?: string;
}

export class CollectInvoicesDto {
  @IsOptional()
  @IsUUID('4')
  cashRegisterId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  invoiceIds: string[];

  @IsEnum(['CASH', 'CARD_DEBIT', 'CARD_CREDIT', 'BANK_TRANSFER', 'MIXED'])
  paymentMethod: 'CASH' | 'CARD_DEBIT' | 'CARD_CREDIT' | 'BANK_TRANSFER' | 'MIXED';

  @IsEnum(['E31', 'E32', 'E33', 'E34', 'E44', 'E45', 'B01', 'B02'])
  ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02';

  @IsOptional()
  @IsNumber()
  cashReceived?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  // Cobra el cargo de reconexión configurado (BillingSettingsEntity.reconnectionFeeAmount)
  // junto con las facturas del lote, en la misma visita — solo válido si todas
  // las facturas pertenecen a un único contrato actualmente SUSPENDED.
  @IsOptional()
  @IsBoolean()
  applyReconnectionFee?: boolean;

  // Descuento manual puntual aplicado a UNA factura específica del lote que se está cobrando
  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceDiscountDto)
  discount?: InvoiceDiscountDto;
}
