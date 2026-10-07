import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ExtendSaasTrialDto {
  @IsOptional()
  @IsInt({ message: 'Los días a extender deben ser un número entero' })
  @Min(1, { message: 'Debe añadir al menos 1 día' })
  @Max(90, { message: 'No puede exceder 90 días de extensión de prueba' })
  daysToAdd?: number = 14;

  @IsOptional()
  @IsString({ message: 'El motivo debe ser una cadena de texto' })
  reason?: string;
}
