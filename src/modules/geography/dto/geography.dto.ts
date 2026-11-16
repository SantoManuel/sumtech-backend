import { IsOptional, IsUUID, IsBoolean, IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class FilterProvinceDto {
  @IsOptional()
  @IsUUID('4')
  countryId?: string;

  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;
}

export class FilterMunicipalityDto {
  @IsOptional()
  @IsUUID('4')
  provinceId?: string;

  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;
}

export class FilterSectorDto {
  @IsOptional()
  @IsUUID('4')
  municipalityId?: string;

  @IsOptional()
  @IsUUID('4')
  provinceId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;
}

export class CreateSectorDto {
  @IsNotEmpty({ message: 'El ID del municipio es obligatorio' })
  @IsUUID('4', { message: 'El ID del municipio debe ser un UUID válido' })
  municipalityId: string;

  @IsNotEmpty({ message: 'El nombre del sector o barrio es obligatorio' })
  @IsString()
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'El código postal no puede exceder 20 caracteres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  postalCode?: string;
}

export class UpdateSectorDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'El código postal no puede exceder 20 caracteres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  postalCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateMunicipalityDto {
  @IsNotEmpty({ message: 'El ID de la provincia es obligatorio' })
  @IsUUID('4', { message: 'El ID de la provincia debe ser un UUID válido' })
  provinceId: string;

  @IsNotEmpty({ message: 'El nombre del municipio es obligatorio' })
  @IsString()
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(10, { message: 'El código no puede exceder 10 caracteres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'El código postal no puede exceder 20 caracteres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  postalCode?: string;
}

export class UpdateMunicipalityDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10, { message: 'El código no puede exceder 10 caracteres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'El código postal no puede exceder 20 caracteres' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  postalCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
