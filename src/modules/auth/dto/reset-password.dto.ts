import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsNotEmpty({ message: 'El token de restablecimiento es obligatorio' })
  @IsString({ message: 'El token debe ser una cadena válida' })
  token: string;

  @IsNotEmpty({ message: 'La nueva contraseña es obligatoria' })
  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @MinLength(8, { message: 'La contraseña debe contener al menos 8 caracteres' })
  newPassword: string;
}
