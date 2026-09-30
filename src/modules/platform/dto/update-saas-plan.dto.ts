import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateSaasPlanDto {
  @IsOptional()
  @IsString({ message: 'El nombre del plan debe ser texto' })
  name?: string;

  @IsOptional()
  @IsNumber({}, { message: 'El precio mensual debe ser un número' })
  @Min(0, { message: 'El precio mensual no puede ser negativo' })
  monthlyPrice?: number;

  @IsOptional()
  @IsNumber({}, { message: 'El límite de usuarios debe ser un número' })
  @Min(1, { message: 'El límite de usuarios debe ser al menos 1' })
  maxUsers?: number;

  @IsOptional()
  @IsNumber({}, { message: 'El límite de clientes debe ser un número' })
  @Min(1, { message: 'El límite de clientes debe ser al menos 1' })
  maxClients?: number;

  @IsOptional()
  features?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean({ message: 'isActive debe ser booleano' })
  isActive?: boolean;
}
