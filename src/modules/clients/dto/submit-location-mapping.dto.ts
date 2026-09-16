import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

export class CreateNewSectorDto {
  @IsString()
  name: string;

  @IsUUID()
  municipalityId: string;
}

export class LocationMappingEntryDto {
  /** Clave devuelta por GET /clients/import/:batchId (buildLocationKey del backend). */
  @IsString()
  legacyLocationKey: string;

  @IsOptional()
  @IsUUID()
  sectorId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateNewSectorDto)
  createNew?: CreateNewSectorDto;
}

export class SubmitLocationMappingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocationMappingEntryDto)
  mappings: LocationMappingEntryDto[];
}
