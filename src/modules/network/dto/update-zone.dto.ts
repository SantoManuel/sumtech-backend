import { IsOptional, IsString, IsBoolean, MaxLength } from 'class-validator';

export class UpdateZoneDto {
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'El nombre de la zona no puede superar 150 caracteres' })
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
