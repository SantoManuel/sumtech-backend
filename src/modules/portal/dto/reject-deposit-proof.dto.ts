import { IsOptional, IsString } from 'class-validator';

export class RejectDepositProofDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
