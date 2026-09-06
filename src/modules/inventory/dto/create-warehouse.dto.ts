import { IsNotEmpty, IsString, IsOptional, MaxLength, IsUUID, IsNumber, IsBoolean } from 'class-validator';

export class CreateWarehouseDto {
  @IsNotEmpty({ message: 'El nombre del almacén es obligatorio' })
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsUUID('4', { message: 'countryId debe ser un UUID válido' })
  countryId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'provinceId debe ser un UUID válido' })
  provinceId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'municipalityId debe ser un UUID válido' })
  municipalityId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'sectorId debe ser un UUID válido' })
  sectorId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsNumber()
  gpsLatitude?: number;

  @IsOptional()
  @IsNumber()
  gpsLongitude?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsUUID('4', { message: 'countryId debe ser un UUID válido' })
  countryId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'provinceId debe ser un UUID válido' })
  provinceId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'municipalityId debe ser un UUID válido' })
  municipalityId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'sectorId debe ser un UUID válido' })
  sectorId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsNumber()
  gpsLatitude?: number;

  @IsOptional()
  @IsNumber()
  gpsLongitude?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
