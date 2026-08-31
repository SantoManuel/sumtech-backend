import { 
  IsNotEmpty, 
  IsUUID, 
  IsEnum, 
  IsArray, 
  ValidateNested, 
  IsPositive, 
  IsInt, 
  Min, 
  Max, 
  IsOptional, 
  IsNumber, 
  IsString 
} from 'class-validator';
import { Type } from 'class-transformer';

export class CheckoutItemDto {
  @IsEnum(['PLAN_SUBSCRIPTION', 'PLAN_ACTIVATION', 'PRODUCT_HARDWARE', 'INSTALLATION_FEE', 'REPAIR_FEE'])
  itemType: 'PLAN_SUBSCRIPTION' | 'PLAN_ACTIVATION' | 'PRODUCT_HARDWARE' | 'INSTALLATION_FEE' | 'REPAIR_FEE';

  @IsOptional()
  @IsUUID('4')
  itemId?: string;

  @IsNotEmpty()
  @IsString()
  concept: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsPositive()
  unitPrice: number;

  @IsNumber()
  itbisAmount: number;
}

export class CheckoutDto {
  @IsOptional()
  @IsUUID('4')
  cashRegisterId?: string;

  @IsNotEmpty()
  @IsUUID('4')
  clientId: string;

  @IsOptional()
  @IsUUID('4')
  contractId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay?: number; // Día elegido por el suscriptor (1-31)

  @IsOptional()
  @IsString()
  billingPeriod?: string; // ej. "Septiembre 2026"

  @IsOptional()
  @IsString()
  dueDate?: string; // ej. "2026-09-20"

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items: CheckoutItemDto[];

  @IsEnum(['CASH', 'CARD_DEBIT', 'CARD_CREDIT', 'BANK_TRANSFER', 'MIXED'])
  paymentMethod: 'CASH' | 'CARD_DEBIT' | 'CARD_CREDIT' | 'BANK_TRANSFER' | 'MIXED';

  @IsEnum(['E31', 'E32', 'E33', 'E34', 'E44', 'E45', 'B01', 'B02'])
  ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02';

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
