import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuspendContractDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observation?: string;
}
