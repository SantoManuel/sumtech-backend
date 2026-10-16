import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class MigrateOnuDto {
  @IsString()
  @IsNotEmpty({ message: 'El nuevo número de serie es obligatorio' })
  newSerialNumber: string;

  @IsOptional()
  @IsString()
  newPonInterface?: string;

  @IsOptional()
  @IsUUID()
  newNapPortId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
