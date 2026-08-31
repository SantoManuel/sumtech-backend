import { IsNotEmpty, IsUUID, IsNumber, IsPositive, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class IngresoConsumableDto {
  @IsNotEmpty()
  @IsUUID('4')
  productId: string;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  supplierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceReference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SalidaATecnicoDto {
  @IsNotEmpty()
  @IsUUID('4')
  productId: string;

  @IsNotEmpty()
  @IsUUID('4')
  employeeId: string;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsUUID('4')
  ticketId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ConsumoInstalacionDto {
  @IsNotEmpty()
  @IsUUID('4')
  productId: string;

  @IsNotEmpty()
  @IsUUID('4')
  employeeId: string;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsNotEmpty()
  @IsUUID('4')
  ticketId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DevolucionAlmacenConsumableDto {
  @IsNotEmpty()
  @IsUUID('4')
  productId: string;

  @IsNotEmpty()
  @IsUUID('4')
  employeeId: string;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AjusteConsumableDto {
  @IsNotEmpty()
  @IsUUID('4')
  productId: string;

  @IsOptional()
  @IsUUID('4')
  employeeId?: string;

  @IsNotEmpty()
  @IsNumber()
  quantityDelta: number;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  reason: string;
}
