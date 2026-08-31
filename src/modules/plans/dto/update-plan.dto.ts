import { IsOptional, IsPositive, IsInt, Min, IsBoolean, IsString } from 'class-validator';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsPositive()
  monthlyPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  speedMbps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  tvChannelsCount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
