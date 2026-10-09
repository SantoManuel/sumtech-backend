import { IsString, IsOptional, IsUUID, IsInt, Min, MaxLength, IsIn } from 'class-validator';

export class UpdateTr069NetworkDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  cidr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  gateway?: string;

  @IsOptional()
  @IsUUID('4', { message: 'vlanId debe ser un UUID válido' })
  vlanId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['DHCP_SERVER', 'STATIC', 'RELAY'])
  dhcpMode?: 'DHCP_SERVER' | 'STATIC' | 'RELAY';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  acsUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  acsUsername?: string;

  /** Texto plano — el servicio lo cifra antes de guardarlo en acsPasswordEnc. Vacío/omitido no borra el existente. */
  @IsOptional()
  @IsString()
  acsPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  connReqUsername?: string;

  /** Texto plano — el servicio lo cifra antes de guardarlo en connReqPasswordEnc. Vacío/omitido no borra el existente. */
  @IsOptional()
  @IsString()
  connReqPassword?: string;

  @IsOptional()
  @IsInt()
  @Min(30, { message: 'El intervalo de Inform no puede ser menor a 30 segundos' })
  informIntervalSec?: number;
}
