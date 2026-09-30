import { IsOptional, IsString } from 'class-validator';

export class SuspendTenantDto {
  @IsOptional()
  @IsString({ message: 'El motivo de suspensión debe ser texto' })
  reason?: string;
}
