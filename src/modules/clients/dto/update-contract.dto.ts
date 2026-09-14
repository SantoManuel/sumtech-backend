import { IsOptional, IsUUID, IsInt, Min, Max } from 'class-validator';

export class UpdateContractDto {
  @IsOptional()
  @IsUUID('4')
  planId?: string;

  @IsOptional()
  @IsUUID('4')
  addressId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay?: number;
}
