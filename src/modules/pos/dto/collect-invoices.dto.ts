import { IsArray, ArrayNotEmpty, IsUUID, IsEnum, IsOptional, IsNumber, IsString } from 'class-validator';

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
}
