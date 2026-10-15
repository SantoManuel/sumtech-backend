import { IsOptional, IsUUID, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** Paginación + filtros para GET /olt/onus/unconfigured. */
export class ListUnconfiguredOnusDto extends PaginationDto {
  @IsOptional()
  @IsUUID('4', { message: 'oltId debe ser un UUID válido' })
  oltId?: string;
}

/**
 * Paginación + filtros para GET /olt/onus. `search` (heredado de
 * PaginationDto) matchea por número de serie, MAC o nombre del cliente.
 */
export class ListOnusDto extends PaginationDto {
  @IsOptional()
  @IsUUID('4', { message: 'oltId debe ser un UUID válido' })
  oltId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
