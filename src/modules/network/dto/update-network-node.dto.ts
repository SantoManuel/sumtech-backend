import { IsOptional, IsString, IsInt, Min, Max, IsUUID, IsEnum, IsBoolean, MaxLength } from 'class-validator';

export class UpdateNetworkNodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'El nombre del nodo no puede superar 150 caracteres' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'El modelo no puede superar 100 caracteres' })
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(45, { message: 'La IP de gestión no puede superar 45 caracteres' })
  managementIp?: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'El puerto de la API debe ser mayor a 0' })
  @Max(65535, { message: 'El puerto de la API no puede superar 65535' })
  apiPort?: number;

  @IsOptional()
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido' })
  zoneId?: string;

  @IsOptional()
  @IsEnum(['MANUAL', 'ROUTEROS'], { message: 'provisioningMode debe ser MANUAL o ROUTEROS' })
  provisioningMode?: 'MANUAL' | 'ROUTEROS';

  @IsOptional()
  @IsBoolean()
  useHttps?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
