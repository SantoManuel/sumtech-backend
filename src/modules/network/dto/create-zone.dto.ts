import { IsNotEmpty, IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateZoneDto {
  @IsNotEmpty({ message: 'El nombre de la zona es requerido' })
  @IsString()
  @MaxLength(150, { message: 'El nombre de la zona no puede superar 150 caracteres' })
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
