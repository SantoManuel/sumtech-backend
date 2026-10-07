import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class ChangeSaasSubscriptionPlanDto {
  @IsUUID('4', { message: 'El ID del plan debe ser un UUID válido v4' })
  @IsNotEmpty({ message: 'El ID del plan es obligatorio' })
  planId: string;

  @IsOptional()
  @IsString({ message: 'El motivo debe ser una cadena de texto' })
  reason?: string;
}
