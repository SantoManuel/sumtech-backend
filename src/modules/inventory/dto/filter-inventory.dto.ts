import { IsBoolean, IsOptional, IsString, IsUUID, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { EquipmentCondition, EquipmentLocationType } from '../enums/equipment.enums';
import { ArticleType } from '../enums/category.enums';

export class FilterProductDto extends PaginationDto {
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  /** Filtra el catálogo a solo productos serializables (ej. el selector de "Producto" en Trazabilidad de Equipos). */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  requiresSerial?: boolean;
}

export class FilterSerialDto extends PaginationDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  status?: string;

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

  /** Código/SKU exacto del producto (ej. desde un escaneo de código de barras). */
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
