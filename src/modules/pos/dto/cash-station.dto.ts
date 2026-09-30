import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsUUID } from 'class-validator';

export class CreateCashStationDto {
  @IsNotEmpty()
  @IsUUID('4')
  branchId: string;

  @IsNotEmpty()
  @IsString()
  name: string;
}

export class UpdateCashStationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
