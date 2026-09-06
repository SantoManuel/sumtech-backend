import { IsOptional, IsUUID, IsBoolean, IsString } from 'class-validator';

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
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;
}
