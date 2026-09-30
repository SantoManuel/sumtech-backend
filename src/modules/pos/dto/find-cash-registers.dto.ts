import { IsOptional, IsInt, Min, Max, IsEnum, IsUUID, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class FindCashRegistersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(['OPEN', 'CLOSED'])
  status?: 'OPEN' | 'CLOSED';

  // Solo aplica para ADMIN/GERENTE — un CAJERO siempre queda restringido a su
  // propio historial en el service, sin importar lo que envíe aquí.
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  // Rango sobre openingDate (YYYY-MM-DD)
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsUUID('4')
  cashStationId?: string;
}
