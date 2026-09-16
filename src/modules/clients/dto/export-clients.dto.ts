import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export type ClientExportFormat = 'pdf' | 'excel' | 'csv';

/**
 * Tope de seguridad general (aplica a excel/csv). El formato 'pdf' se re-valida
 * en ClientsExportService con un tope más bajo (ver PDF_EXPORT_MAX_ROWS) — un
 * PDF paginado con decenas de miles de filas es impráctico para imprimir.
 */
export const EXPORT_MAX_ROWS = 20000;

export class ExportClientsDto {
  @IsIn(['pdf', 'excel', 'csv'])
  format: ClientExportFormat;

  @Type(() => Number)
  @IsInt({ message: 'La cantidad de clientes a exportar debe ser un número entero' })
  @Min(1, { message: 'Debe exportar al menos 1 cliente' })
  @Max(EXPORT_MAX_ROWS, { message: `La cantidad de clientes a exportar no puede superar ${EXPORT_MAX_ROWS}` })
  limit: number;

  @IsOptional()
  @IsString()
  search?: string;

  // "Estado" en la tabla de /dashboard/clientes = client.isActive (Activo/Inactivo).
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  isActive?: boolean;

  // "Plan Activo": clientes con un contrato ACTIVE sobre este plan.
  @IsOptional()
  @IsUUID()
  planId?: string;

  // "Ubicación" en cascada — se aplica el filtro más específico presente.
  @IsOptional()
  @IsUUID()
  provinceId?: string;

  @IsOptional()
  @IsUUID()
  municipalityId?: string;

  @IsOptional()
  @IsUUID()
  sectorId?: string;
}
