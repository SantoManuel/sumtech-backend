import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpsertNetworkAccessDto {
  @IsOptional()
  @IsUUID('4', { message: 'nodeId debe ser un UUID válido' })
  nodeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'El usuario no puede superar 150 caracteres' })
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'El alias de servicio no puede superar 50 caracteres' })
  serviceAlias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(45, { message: 'La IP no puede superar 45 caracteres' })
  ipAddress?: string;
}
