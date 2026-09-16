import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsUUID,
  IsBoolean,
  IsObject,
  MaxLength,
} from 'class-validator';

export class CreateTenantConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  tenantCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  commercialName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  rnc: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsUUID()
  @IsOptional()
  countryId?: string;

  @IsUUID()
  @IsOptional()
  provinceId?: string;

  @IsUUID()
  @IsOptional()
  municipalityId?: string;

  @IsUUID()
  @IsOptional()
  sectorId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(150)
  email?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(150)
  supportEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  website?: string;

  @IsString()
  @IsOptional()
  logoUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  currency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  timezone?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;
}
