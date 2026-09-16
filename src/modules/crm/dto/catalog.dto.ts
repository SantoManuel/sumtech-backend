import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSubscriptionStatusDto {
  @IsNotEmpty({ message: 'El nombre del estado es obligatorio' })
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateSubscriptionStatusDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateNextActionDto {
  @IsNotEmpty({ message: 'El nombre de la próxima acción es obligatorio' })
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  suggestedStatusCodes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateNextActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  suggestedStatusCodes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateLossReasonDto {
  @IsNotEmpty({ message: 'El nombre del motivo de pérdida es obligatorio' })
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateLossReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpsertSlaPolicyDto {
  @IsNotEmpty({ message: 'El estado de suscripción es obligatorio' })
  @IsUUID('4')
  subscriptionStatusId: string;

  @IsNotEmpty({ message: 'El máximo de días sin actividad es obligatorio' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  maxDaysWithoutActivity: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
