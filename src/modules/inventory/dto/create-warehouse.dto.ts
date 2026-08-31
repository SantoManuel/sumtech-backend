import { IsNotEmpty, IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateWarehouseDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  address?: string;
}
