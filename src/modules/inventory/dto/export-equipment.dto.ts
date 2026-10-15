import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { EquipmentCondition, EquipmentLocationType } from '../enums/equipment.enums';
import { ArticleType } from '../enums/category.enums';

export type EquipmentExportFormat = 'csv' | 'pdf';

/**
 * Tope de seguridad general (aplica a csv). El formato 'pdf' se re-valida en
 * InventoryExportService con un tope más bajo (ver EQUIPMENT_PDF_EXPORT_MAX_ROWS)
 * — un PDF paginado con decenas de miles de filas es impráctico para imprimir.
 * No extiende FilterSerialDto a propósito: ese hereda `limit` de PaginationDto
 * (tope 500, pensado para grillas paginadas), que es demasiado bajo para una
 * exportación completa.
 */
export const EQUIPMENT_EXPORT_MAX_ROWS = 20000;

export class ExportEquipmentDto {
  @IsIn(['csv', 'pdf'])
  format: EquipmentExportFormat;

  @Type(() => Number)
  @IsInt({ message: 'La cantidad de equipos a exportar debe ser un número entero' })
  @Min(1, { message: 'Debe exportar al menos 1 equipo' })
  @Max(EQUIPMENT_EXPORT_MAX_ROWS, { message: `La cantidad de equipos a exportar no puede superar ${EQUIPMENT_EXPORT_MAX_ROWS}` })
  limit: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID('4')
  productId?: string;

  @IsOptional()
  @IsEnum(EquipmentLocationType)
  locationType?: EquipmentLocationType;

  @IsOptional()
  @IsEnum(EquipmentCondition)
  condition?: EquipmentCondition;

  @IsOptional()
  @IsUUID('4')
  employeeId?: string;

  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;

  @IsOptional()
  @IsEnum(ArticleType)
  articleType?: ArticleType;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @IsOptional()
  @IsUUID('4')
  supplierId?: string;
}
