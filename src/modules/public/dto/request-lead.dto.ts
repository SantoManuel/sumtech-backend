import { IsNotEmpty, IsString, IsOptional, IsEmail, IsUUID } from 'class-validator';

export class RequestLeadDto {
  @IsNotEmpty({ message: 'El nombre es requerido' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'El teléfono es requerido' })
  @IsString()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsUUID('4')
  planId?: string;

  @IsNotEmpty({ message: 'El sector o dirección es requerido' })
  @IsString()
  sector: string;
}
