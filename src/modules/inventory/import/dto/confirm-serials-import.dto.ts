import { IsArray, IsInt, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SerialImportRowDto {
  @IsInt()
  @Min(1)
  rowNumber: number;

  @IsOptional()
  @IsString()
  producto?: string;

  @IsOptional()
  @IsString()
  serial?: string;

  @IsOptional()
  @IsString()
  mac?: string;

  @IsOptional()
  @IsString()
  almacen?: string;
}

/**
 * Confirma la recepción masiva de unidades serializadas (el caso de "llegaron
 * 50 ONUs"). Igual que ConfirmProductsImportDto: stateless, el frontend
 * reenvía las filas de `analyze()` más los mapeos manuales de producto/almacén
 * no reconocidos automáticamente.
 */
export class ConfirmSerialsImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SerialImportRowDto)
  rows: SerialImportRowDto[];

  /** Texto de producto (tal cual vino en `unresolvedProducts`) -> UUID de un producto YA EXISTENTE y serializable. */
  @IsOptional()
  @IsObject()
  productMappings?: Record<string, string>;

  @IsOptional()
  @IsObject()
  warehouseMappings?: Record<string, string>;
}
