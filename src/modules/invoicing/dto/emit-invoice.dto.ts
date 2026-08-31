import { IsNotEmpty, IsUUID, IsEnum, IsOptional, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class EmitInvoiceDto {
  @IsNotEmpty()
  @IsUUID('4')
  saleId: string;

  @IsEnum(['E31', 'E32', 'E33', 'E34', 'E44', 'E45', 'B01', 'B02'])
  ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02';

  @IsOptional()
  @IsString()
  ncfModificado?: string;

  @IsOptional()
  @IsEnum(['1', '2', '3', '4', '5'])
  codigoModificacion?: '1' | '2' | '3' | '4' | '5';

  @IsOptional()
  @IsString()
  razonModificacion?: string;
}
