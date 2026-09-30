import { IsOptional, IsPositive, IsBoolean, IsUrl, IsString, IsUUID } from 'class-validator';

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

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsUUID('4')
  defaultCashStationId?: string;
}
