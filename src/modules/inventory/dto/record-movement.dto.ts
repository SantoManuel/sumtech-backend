import {
  IsNotEmpty,
  IsEnum,
  IsInt,
  Min,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SerialInputDto {
  @IsNotEmpty()
  @IsString()
  serialNumber: string;

  @IsNotEmpty()
  @IsString()
  macAddress: string;
}

/**
 * Registra una entrada/salida masiva de almacén para un producto.
 * - Si el producto requiere serial (requiresSerial=true) y movementType='IN_PURCHASE',
 *   `serials` es obligatorio y debe tener exactamente `quantity` elementos: se crea
 *   un EquipmentItem por cada uno, en almacén y condición NEW.
 * - Para 'ADJUSTMENT' se usa `adjustmentDelta` (puede ser negativo) en vez de `quantity`.
 */
export class RecordMovementDto {
  @IsNotEmpty()
  @IsUUID('4')
  productId: string;

  @IsEnum(['IN_PURCHASE', 'OUT_SALE', 'OUT_INSTALLATION', 'IN_REPAIR_RETURN', 'ADJUSTMENT'])
  movementType: 'IN_PURCHASE' | 'OUT_SALE' | 'OUT_INSTALLATION' | 'IN_REPAIR_RETURN' | 'ADJUSTMENT';

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsInt()
  adjustmentDelta?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SerialInputDto)
  serials?: SerialInputDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
