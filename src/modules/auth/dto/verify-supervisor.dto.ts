import { IsNotEmpty, IsString } from 'class-validator';

export class VerifySupervisorDto {
  @IsNotEmpty({ message: 'El usuario o correo del supervisor es requerido' })
  @IsString({ message: 'El identificador debe ser texto' })
  identifier: string;

  @IsNotEmpty({ message: 'La contraseña del supervisor es requerida' })
  @IsString({ message: 'La contraseña debe ser texto' })
  password: string;
}
