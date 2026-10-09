import { IsOptional, IsString, IsUUID, IsIn, MaxLength } from 'class-validator';

export class UpsertNetworkAccessDto {
  @IsOptional()
  @IsUUID('4', { message: 'nodeId debe ser un UUID válido' })
  nodeId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'onuId debe ser un UUID válido' })
  onuId?: string;

  @IsOptional()
  @IsIn(['PPPOE', 'OLT_NATIVE', 'DHCP'], { message: 'suspensionMediumOverride debe ser PPPOE, OLT_NATIVE o DHCP' })
  suspensionMediumOverride?: 'PPPOE' | 'OLT_NATIVE' | 'DHCP';

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

  @IsOptional()
  @IsString()
  @MaxLength(17, { message: 'La MAC no puede superar 17 caracteres' })
  macAddress?: string;

  @IsOptional()
  @IsUUID('4', { message: 'vlanId debe ser un UUID válido' })
  vlanId?: string;
}
