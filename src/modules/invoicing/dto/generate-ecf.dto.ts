import { IsNotEmpty, IsString, IsOptional, IsNumber, IsPositive, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class EcfItemDto {
  @IsNotEmpty()
  @IsString()
  concept: string;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsNotEmpty()
  @IsNumber()
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  itbisRate?: number;

  @IsOptional()
  @IsEnum(['1', '2'])
  indicadorBienoServicio?: '1' | '2';
}

export class GenerateEcfDto {
  @IsNotEmpty()
  @IsEnum(['E31', 'E32', 'E33', 'E34', 'E44', 'E45', 'B01', 'B02'])
  ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02';

  @IsOptional()
  @IsString()
  rncBuyer?: string;

  @IsNotEmpty()
  @IsString()
  nameBuyer: string;

  @IsOptional()
  @IsString()
  emailBuyer?: string;

  @IsOptional()
  @IsString()
  addressBuyer?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EcfItemDto)
  items: EcfItemDto[];

  @IsOptional()
  @IsString()
  ncfModificado?: string;

  @IsOptional()
  @IsString()
  codigoModificacion?: '1' | '2' | '3' | '4' | '5';
}
