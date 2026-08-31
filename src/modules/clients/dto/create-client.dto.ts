import { IsNotEmpty, IsEnum, IsEmail, IsString, IsOptional, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAddressDto {
  @IsNotEmpty()
  @IsString()
  street: string;

  @IsOptional()
  @IsString()
  buildingNumber?: string;

  @IsNotEmpty()
  @IsString()
  sector: string;

  @IsNotEmpty()
  @IsString()
  municipality: string;

  @IsNotEmpty()
  @IsString()
  city: string;

  @IsOptional()
  @IsNumber()
  gpsLatitude?: number;

  @IsOptional()
  @IsNumber()
  gpsLongitude?: number;

  @IsOptional()
  @IsString()
  reference?: string;
}

export class CreateClientDto {
  @IsEnum(['FISICA', 'JURIDICA'])
  clientType: 'FISICA' | 'JURIDICA';

  @IsNotEmpty({ message: 'El nombre o razón social es obligatorio' })
  @IsString()
  name: string;

  @IsEnum(['CEDULA', 'RNC', 'PASAPORTE'])
  docType: 'CEDULA' | 'RNC' | 'PASAPORTE';

  @IsNotEmpty({ message: 'El número de documento es obligatorio' })
  @IsString()
  docNumber: string;

  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  email: string;

  @IsNotEmpty({ message: 'El teléfono es obligatorio' })
  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  altPhone?: string;

  @ValidateNested()
  @Type(() => CreateAddressDto)
  address: CreateAddressDto;
}
