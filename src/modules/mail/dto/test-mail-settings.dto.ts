import { IsEmail, IsNotEmpty } from 'class-validator';

export class TestMailSettingsDto {
  @IsNotEmpty({ message: 'El correo de destino es requerido' })
  @IsEmail({}, { message: 'El correo de destino no es válido' })
  to: string;
}
