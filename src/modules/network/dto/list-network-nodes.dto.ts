import { IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListNetworkNodesDto extends PaginationDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;

  @IsOptional()
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido' })
  zoneId?: string;
}
