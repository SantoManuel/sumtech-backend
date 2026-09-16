import { IsNotEmpty, IsEnum, IsEmail, IsString, IsOptional, ValidateNested, IsNumber, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAddressDto {
  @IsNotEmpty()
  @IsString()
  street: string;

  @IsOptional()
  @IsString()
  buildingNumber?: string;

  // sector/municipality/city como texto libre quedan opcionales: si se manda
  // sectorId, ClientsService las resuelve automáticamente a partir del
  // módulo de geografía. Siguen siendo obligatorias si no se manda sectorId
  // (ClientsService.create() valida esto explícitamente).
  @IsOptional()
  @IsString()
  sector?: string;

  @IsOptional()
  @IsString()
  municipality?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsUUID('4')
  countryId?: string;

  @IsOptional()
  @IsUUID('4')
  provinceId?: string;

  @IsOptional()
  @IsUUID('4')
  municipalityId?: string;

  @IsOptional()
  @IsUUID('4')
  sectorId?: string;

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
