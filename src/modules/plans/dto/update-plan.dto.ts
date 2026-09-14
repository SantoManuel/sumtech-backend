import { IsOptional, IsPositive, IsInt, Min, Max, IsBoolean, IsString, IsEnum, IsNumber } from 'class-validator';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['INTERNET', 'TV', 'DUAL'], { message: 'Tipo de servicio debe ser INTERNET, TV o DUAL' })
  serviceType?: 'INTERNET' | 'TV' | 'DUAL';

  @IsOptional()
  @IsPositive()
  @Max(999999.99, { message: 'El precio mensual excede el máximo permitido' })
  monthlyPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  speedMbps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  tvChannelsCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'El ITBIS no puede ser negativo' })
  @Max(0.9999, { message: 'El ITBIS no puede superar 99.99%' })
  itbisRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'El CDT no puede ser negativo' })
  @Max(0.9999, { message: 'El CDT no puede superar 99.99%' })
  cdtRate?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
