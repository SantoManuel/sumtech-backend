import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const OLT_EXPORT_MAX_ROWS = 5000;

export class ExportOltsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La cantidad de OLTs a exportar debe ser un número entero' })
  @Min(1, { message: 'Debe exportar al menos 1 OLT' })
  @Max(OLT_EXPORT_MAX_ROWS, { message: `La cantidad de OLTs a exportar no puede superar ${OLT_EXPORT_MAX_ROWS}` })
  limit?: number = OLT_EXPORT_MAX_ROWS;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  connectionStatus?: string;
}
