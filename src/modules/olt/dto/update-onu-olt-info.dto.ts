import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOnuOltInfoDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
