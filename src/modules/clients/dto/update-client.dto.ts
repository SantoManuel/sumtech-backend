import { IsOptional, IsEmail, IsString, IsBoolean, IsEnum, IsNotEmpty } from 'class-validator';

export class UpdateClientDto {
  @IsOptional()
  @IsEnum(['FISICA', 'JURIDICA'], { message: 'Tipo de cliente debe ser FISICA o JURIDICA' })
  clientType?: 'FISICA' | 'JURIDICA';

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(['CEDULA', 'RNC', 'PASAPORTE'], { message: 'Tipo de documento debe ser CEDULA, RNC o PASAPORTE' })
  docType?: 'CEDULA' | 'RNC' | 'PASAPORTE';

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El número de documento no puede estar vacío' })
  docNumber?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  altPhone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
