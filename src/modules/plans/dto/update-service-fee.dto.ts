import { IsOptional, IsPositive, Min, Max, IsBoolean, IsString, IsEnum, IsNumber } from 'class-validator';

export class UpdateServiceFeeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['INSTALLATION_FEE', 'REPAIR_FEE'], { message: 'Tipo de cargo debe ser INSTALLATION_FEE o REPAIR_FEE' })
  feeType?: 'INSTALLATION_FEE' | 'REPAIR_FEE';

  @IsOptional()
  @IsPositive({ message: 'El precio debe ser positivo' })
  @Max(999999.99, { message: 'El precio excede el máximo permitido' })
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'El ITBIS no puede ser negativo' })
  @Max(0.9999, { message: 'El ITBIS no puede superar 99.99%' })
  itbisRate?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
