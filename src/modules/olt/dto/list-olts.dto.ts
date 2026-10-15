import { IsOptional, IsBoolean, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Filtros + paginación para GET /olt/olts. `search` (heredado de
 * PaginationDto) matchea por nombre o host/IP de gestión.
 */
export class ListOltsDto extends PaginationDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  activeOnly?: boolean;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  connectionStatus?: string;
}
