import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  rnc?: string;

  @IsOptional()
  @IsUUID('4', { message: 'El planId debe ser un UUID válido' })
  planId?: string;
}
