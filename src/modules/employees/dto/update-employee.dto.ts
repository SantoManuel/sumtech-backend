import { IsOptional, IsPositive, IsBoolean, IsUrl, IsString } from 'class-validator';

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsPositive()
  salary?: number;

  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
