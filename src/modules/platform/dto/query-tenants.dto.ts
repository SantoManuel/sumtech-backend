import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TenantStatus } from '../enums/tenant-status.enum';

export class QueryTenantsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(TenantStatus, { message: 'El estado no es un valor válido' })
  status?: TenantStatus;
}
