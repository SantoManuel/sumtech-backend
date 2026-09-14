import { IsOptional, IsInt, Min, Max, IsEnum, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class FindContractsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsEnum(['PENDING_INSTALL', 'ACTIVE', 'SUSPENDED', 'TERMINATED'])
  status?: 'PENDING_INSTALL' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';

  @IsOptional()
  @IsString()
  search?: string;
}
