import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateEcfSequenceDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La secuencia actual debe ser un número entero' })
  @Min(1, { message: 'La secuencia actual debe ser mayor o igual a 1' })
  currentSequence?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La secuencia inicial debe ser un número entero' })
  @Min(1, { message: 'La secuencia inicial debe ser mayor o igual a 1' })
  startSequence?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La secuencia final debe ser un número entero' })
  @Min(1, { message: 'La secuencia final debe ser mayor o igual a 1' })
  endSequence?: number;

  @IsOptional()
  @IsString({ message: 'El número de autorización debe ser una cadena de texto' })
  authorizationNumber?: string;

  @IsOptional()
  @IsString({ message: 'La fecha de vencimiento debe ser una cadena de texto' })
  expiryDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El umbral de alerta debe ser un número entero' })
  @Min(1, { message: 'El umbral de alerta debe ser mayor o igual a 1' })
  alertRemaining?: number;

  @IsOptional()
  @IsBoolean({ message: 'isActive debe ser un valor booleano' })
  isActive?: boolean;
}

