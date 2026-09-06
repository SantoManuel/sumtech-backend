import { IsNotEmpty, IsUUID, IsNumber, IsInt, Min, IsOptional, IsBoolean, IsString } from 'class-validator';

export class CreateProductDto {
  @IsNotEmpty({ message: 'El SKU o código interno es obligatorio' })
  @IsString()
  sku: string;

  @IsNotEmpty({ message: 'El nombre del artículo es obligatorio' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'La categoría es obligatoria' })
  @IsUUID('4', { message: 'categoryId debe ser un UUID válido' })
  categoryId: string;

  @IsOptional()
  @IsUUID('4', { message: 'supplierId debe ser un UUID válido' })
  supplierId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'defaultWarehouseId debe ser un UUID válido' })
  defaultWarehouseId?: string;

  @IsNotEmpty({ message: 'La marca o fabricante es obligatorio' })
  @IsString()
  brand: string;

  @IsNotEmpty({ message: 'El modelo es obligatorio' })
  @IsString()
  model: string;

  @IsOptional()
  @IsString()
  unitOfMeasure?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  manufacturerCode?: string;

  @IsOptional()
  @IsString()
  binLocation?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber({}, { message: 'El costo unitario debe ser un número' })
  @Min(0, { message: 'El costo unitario no puede ser negativo' })
  costPrice: number;

  @IsOptional()
  @IsNumber({}, { message: 'El valor de reposición debe ser un número' })
  @Min(0, { message: 'El valor de reposición no puede ser negativo' })
  salePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stockCurrent?: number;

  @IsInt()
  @Min(0)
  stockMinimum: number;

  @IsOptional()
  @IsBoolean()
  requiresSerial?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID('4', { message: 'categoryId debe ser un UUID válido' })
  categoryId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'supplierId debe ser un UUID válido' })
  supplierId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'defaultWarehouseId debe ser un UUID válido' })
  defaultWarehouseId?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  unitOfMeasure?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  manufacturerCode?: string;

  @IsOptional()
  @IsString()
  binLocation?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber({}, { message: 'El costo unitario debe ser un número' })
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsNumber({}, { message: 'El valor de reposición debe ser un número' })
  @Min(0)
  salePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stockMinimum?: number;

  @IsOptional()
  @IsBoolean()
  requiresSerial?: boolean;
}
