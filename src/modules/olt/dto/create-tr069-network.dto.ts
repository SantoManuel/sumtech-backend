import { IsNotEmpty, IsString, IsOptional, IsUUID, IsInt, Min, MaxLength, IsIn } from 'class-validator';

export class CreateTr069NetworkDto {
  @IsNotEmpty({ message: 'El nombre de la red TR-069 es requerido' })
  @IsString()
  @MaxLength(100)
  name: string;

  /** Rango de IPs de esta red, ej. "10.15.160.0/22". */
  @IsNotEmpty({ message: 'El CIDR es requerido' })
  @IsString()
  @MaxLength(50)
  cidr: string;

  @IsNotEmpty({ message: 'El gateway es requerido' })
  @IsString()
  @MaxLength(45)
  gateway: string;

  @IsOptional()
  @IsUUID('4', { message: 'vlanId debe ser un UUID válido' })
  vlanId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['DHCP_SERVER', 'STATIC', 'RELAY'])
  dhcpMode?: 'DHCP_SERVER' | 'STATIC' | 'RELAY';

  /** URL del ACS (GenieACS CWMP) que los CPEs de esta red deben usar, ej. "http://66.94.107.219:7547". */
  @IsNotEmpty({ message: 'La URL del ACS es requerida' })
  @IsString()
  @MaxLength(255)
  acsUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  acsUsername?: string;

  /** Texto plano — el servicio lo cifra antes de guardarlo en acsPasswordEnc. */
  @IsOptional()
  @IsString()
  acsPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  connReqUsername?: string;

  /** Texto plano — el servicio lo cifra antes de guardarlo en connReqPasswordEnc. */
  @IsOptional()
  @IsString()
  connReqPassword?: string;

  @IsOptional()
  @IsInt()
  @Min(30, { message: 'El intervalo de Inform no puede ser menor a 30 segundos' })
  informIntervalSec?: number;
}
