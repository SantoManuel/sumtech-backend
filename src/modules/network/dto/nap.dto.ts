import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsUUID,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateNapBoxDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsUUID()
  oltId?: string;

  @IsOptional()
  @IsString()
  ponInterface?: string;

  @IsOptional()
  @IsString()
  splitterRatio?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(128)
  totalPorts?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateNapBoxDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  oltId?: string;

  @IsOptional()
  @IsString()
  ponInterface?: string;

  @IsOptional()
  @IsString()
  splitterRatio?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListNapBoxesDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsOptional()
  @IsUUID()
  oltId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateNapPortDto {
  @IsOptional()
  @IsIn(['DISPONIBLE', 'OCUPADO', 'DANADO', 'RESERVADO'])
  status?: 'DISPONIBLE' | 'OCUPADO' | 'DANADO' | 'RESERVADO';

  @IsOptional()
  @IsUUID()
  onuId?: string | null;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  attenuationDb?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
