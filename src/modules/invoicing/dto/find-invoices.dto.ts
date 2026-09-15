import { IsOptional, IsInt, Min, Max, IsEnum, IsUUID, IsString, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class FindInvoicesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsEnum(['PENDING_PAYMENT', 'ISSUED', 'VOIDED'])
  status?: 'PENDING_PAYMENT' | 'ISSUED' | 'VOIDED';

  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  // Rango de fecha de vencimiento (YYYY-MM-DD) — usado por el listado cross-cliente
  // de facturas pendientes del POS, para filtrar por cuándo vence el cobro.
  @IsOptional()
  @IsDateString()
  dueDateFrom?: string;

  @IsOptional()
  @IsDateString()
  dueDateTo?: string;

  // Filtro rápido de cobranza para el POS: solo vencidas, o próximas a vencer
  // dentro de `upcomingDays` (default 7). Se aplica además de dueDateFrom/dueDateTo.
  @IsOptional()
  @IsEnum(['OVERDUE', 'UPCOMING'])
  dueStatus?: 'OVERDUE' | 'UPCOMING';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  upcomingDays?: number;

  // Filtra por el sector/zona de la dirección principal del cliente (com.addresses.sector_id).
  @IsOptional()
  @IsUUID('4')
  sectorId?: string;

  // Sin especificar, InvoicingService.findAll() mantiene el orden actual
  // (issuedAt DESC, usado por /dashboard/facturas). El POS pasa explícitamente
  // sortBy=dueDate&sortDir=ASC para priorizar lo que vence primero.
  @IsOptional()
  @IsEnum(['issuedAt', 'dueDate'])
  sortBy?: 'issuedAt' | 'dueDate';

  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortDir?: 'ASC' | 'DESC';
}
