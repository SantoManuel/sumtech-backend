import { IsNotEmpty, IsEnum, IsInt, Min, Max, IsPositive, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class CreatePlanDto {
  @IsNotEmpty({ message: 'El nombre del plan es requerido' })
  name: string;

  @IsEnum(['INTERNET', 'TV', 'DUAL'], { message: 'Tipo de servicio debe ser INTERNET, TV o DUAL' })
  serviceType: 'INTERNET' | 'TV' | 'DUAL';

  @IsInt()
  @Min(0)
  speedMbps: number;

  @IsInt()
  @Min(0)
  tvChannelsCount: number;

  @IsPositive({ message: 'El precio mensual debe ser positivo' })
  @Max(999999.99, { message: 'El precio mensual excede el máximo permitido' })
  monthlyPrice: number;

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
  description?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
