import { IsNotEmpty, IsPositive, IsOptional, IsString } from 'class-validator';

export class OpenCashRegisterDto {
  @IsNotEmpty()
  @IsPositive()
  openingAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CloseCashRegisterDto {
  @IsNotEmpty()
  @IsPositive()
  realClosingAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
