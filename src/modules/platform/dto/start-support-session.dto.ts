import { IsNotEmpty, IsString, IsUUID, MinLength } from 'class-validator';

export class StartSupportSessionDto {
  @IsUUID('4', { message: 'El tenantId debe ser un UUID válido' })
  @IsNotEmpty({ message: 'El tenantId es requerido' })
  tenantId: string;

  @IsString({ message: 'El motivo debe ser texto' })
  @IsNotEmpty({ message: 'El motivo de acceso de soporte es obligatorio' })
  @MinLength(10, { message: 'El motivo debe contener al menos 10 caracteres explicativos' })
  reason: string;
}
