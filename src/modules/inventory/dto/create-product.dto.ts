import { IsNotEmpty, IsEnum, IsPositive, IsInt, Min, IsOptional, IsBoolean, IsString } from 'class-validator';

export class CreateProductDto {
  @IsNotEmpty()
  @IsString()
  sku: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsEnum(['ROUTER_ONU', 'SET_TOP_BOX', 'FIBER_CABLE', 'CONNECTOR', 'ACCESSORY'])
  category: 'ROUTER_ONU' | 'SET_TOP_BOX' | 'FIBER_CABLE' | 'CONNECTOR' | 'ACCESSORY';

  @IsNotEmpty()
  @IsString()
  brand: string;

  @IsNotEmpty()
  @IsString()
  model: string;

  @IsPositive()
  costPrice: number;

  @IsPositive()
  salePrice: number;

  @IsInt()
  @Min(0)
  stockCurrent: number;

  @IsInt()
  @Min(1)
  stockMinimum: number;

  @IsOptional()
  @IsBoolean()
  requiresSerial?: boolean;
}
