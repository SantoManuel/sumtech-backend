import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional, IsBoolean, Length } from 'class-validator';

export class CreateOltSpeedProfileDto {
  @IsString()
  @IsNotEmpty({ message: 'El código del perfil OLT es obligatorio' })
  @Length(2, 50)
  code: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre del perfil OLT es obligatorio' })
  @Length(2, 100)
  name: string;

  @IsInt()
  @Min(64, { message: 'La velocidad de bajada mínima es 64 Kbps' })
  @Max(10000000, { message: 'La velocidad de bajada máxima es 10 Gbps' })
  downKbps: number;

  @IsInt()
  @Min(64, { message: 'La velocidad de subida mínima es 64 Kbps' })
  @Max(10000000, { message: 'La velocidad de subida máxima es 10 Gbps' })
  upKbps: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  vendorTcontProfile?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  vendorTrafficProfile?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOltSpeedProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 50)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(10000000)
  downKbps?: number;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(10000000)
  upKbps?: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  vendorTcontProfile?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  vendorTrafficProfile?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
