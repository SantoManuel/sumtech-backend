import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class QueryNcfDto {
  @IsNotEmpty()
  @IsString()
  rncOrCedula: string;
}

export class QueryTrackIdDto {
  @IsNotEmpty()
  @IsString()
  trackId: string;
}

export class QueryEcfStatusDto {
  @IsNotEmpty()
  @IsString()
  eNcf: string;

  @IsOptional()
  @IsString()
  rncComprador?: string;

  @IsOptional()
  @IsString()
  securityCode?: string;
}
