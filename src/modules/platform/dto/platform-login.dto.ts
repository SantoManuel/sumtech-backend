import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class PlatformLoginDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido' })
  email: string;

  @IsNotEmpty({ message: 'La contraseña es requerida' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password: string;
}
