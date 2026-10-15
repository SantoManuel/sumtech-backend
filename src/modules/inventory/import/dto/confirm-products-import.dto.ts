import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ProductImportRowDto {
  @IsInt()
  @Min(1)
  rowNumber: number;

  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsString()
  proveedor?: string;

  @IsOptional()
  @IsString()
  marca?: string;

  @IsOptional()
  @IsString()
  modelo?: string;

  @IsOptional()
  @IsString()
  precioCosto?: string;

  @IsOptional()
  @IsString()
  precioVenta?: string;

  @IsOptional()
  @IsString()
  unidadMedida?: string;

  @IsOptional()
  @IsString()
  stockMinimo?: string;

  @IsOptional()
  @IsString()
  almacen?: string;

  @IsOptional()
  @IsString()
  requiereSerial?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
}

/**
 * Confirma la importación de catálogo. Es intencionalmente STATELESS (no hay
 * un batchId persistido en servidor): el frontend reenvía las filas tal cual
 * las devolvió `analyze()` (el usuario pudo haber editado/descartado algunas),
 * más las decisiones de mapeo manual para categorías/proveedores/almacenes que
 * `analyze()` reportó como no reconocidos.
 */
export class ConfirmProductsImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImportRowDto)
  rows: ProductImportRowDto[];

  /**
   * Texto normalizado de categoría (tal cual vino en `unresolvedCategories`) ->
   * UUID de una categoría YA EXISTENTE. No se auto-crean categorías nuevas
   * desde el import: CreateCategoryDto exige `code` y `articleType`, que un
   * nombre suelto en una celda de Excel no puede inferir con seguridad.
   */
  @IsOptional()
  @IsObject()
  categoryMappings?: Record<string, string>;

  @IsOptional()
  @IsObject()
  supplierMappings?: Record<string, string>;

  @IsOptional()
  @IsObject()
  warehouseMappings?: Record<string, string>;
}
