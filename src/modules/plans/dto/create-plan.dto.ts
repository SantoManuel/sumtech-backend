import { IsNotEmpty, IsEnum, IsInt, Min, IsPositive, IsOptional, IsBoolean, IsNumber } from 'class-validator';

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
  monthlyPrice: number;

  @IsOptional()
  @IsNumber()
  itbisRate?: number;

  @IsOptional()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
