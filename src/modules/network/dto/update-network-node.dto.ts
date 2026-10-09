import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsUUID,
  IsEnum,
  IsBoolean,
  MaxLength,
  IsIn,
} from 'class-validator';

export class UpdateNetworkNodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'El nombre del nodo no puede superar 150 caracteres' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'El modelo no puede superar 100 caracteres' })
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(45, { message: 'La IP de gestión no puede superar 45 caracteres' })
  managementIp?: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'El puerto de la API debe ser mayor a 0' })
  @Max(65535, { message: 'El puerto de la API no puede superar 65535' })
  apiPort?: number;

  @IsOptional()
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido' })
  zoneId?: string;

  @IsOptional()
  @IsEnum(['MANUAL', 'ROUTEROS'], { message: 'provisioningMode debe ser MANUAL o ROUTEROS' })
  provisioningMode?: 'MANUAL' | 'ROUTEROS';

  @IsOptional()
  @IsBoolean()
  useHttps?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['wireguard', 'ddns', 'public_ip', 'api', 'ssh'], {
    message: 'connectionMethod debe ser wireguard, ddns, public_ip, api o ssh',
  })
  connectionMethod?: 'wireguard' | 'ddns' | 'public_ip' | 'api' | 'ssh';

  @IsOptional()
  @IsString()
  @IsIn(['REST', 'ROUTEROS_API', 'SSH'], {
    message: 'transportType debe ser REST, ROUTEROS_API o SSH',
  })
  transportType?: 'REST' | 'ROUTEROS_API' | 'SSH';

  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'UNREACHABLE', 'ERROR_AUTH', 'MAINTENANCE', 'PROVISIONING'], {
    message: 'status debe ser ACTIVE, UNREACHABLE, ERROR_AUTH, MAINTENANCE o PROVISIONING',
  })
  status?: 'ACTIVE' | 'UNREACHABLE' | 'ERROR_AUTH' | 'MAINTENANCE' | 'PROVISIONING';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ddnsHostname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  wireguardPublicKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  wireguardListenPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  wireguardIp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apiUser?: string;

  @IsOptional()
  @IsString()
  apiPassword?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @IsOptional()
  @IsString()
  @IsIn(['PPPOE', 'OLT_NATIVE', 'DHCP'], {
    message: 'suspensionMedium debe ser PPPOE, OLT_NATIVE o DHCP',
  })
  suspensionMedium?: 'PPPOE' | 'OLT_NATIVE' | 'DHCP';

  @IsOptional()
  @IsString()
  @IsIn(['DISABLED', 'DISABLE_SECRET', 'NOTICE_PORTAL'], {
    message: 'suspensionMode debe ser DISABLED, DISABLE_SECRET o NOTICE_PORTAL',
  })
  suspensionMode?: 'DISABLED' | 'DISABLE_SECRET' | 'NOTICE_PORTAL';

  @IsOptional()
  @IsString()
  @MaxLength(45)
  portalIp?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  portalPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  wanInterfaceName?: string;

  @IsOptional()
  @IsString()
  @IsIn(['STATIC', 'DHCP_CLIENT', 'PPPOE_CLIENT'], {
    message: 'wanMode debe ser STATIC, DHCP_CLIENT o PPPOE_CLIENT',
  })
  wanMode?: 'STATIC' | 'DHCP_CLIENT' | 'PPPOE_CLIENT';

  @IsOptional()
  @IsString()
  @MaxLength(45)
  wanStaticIp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  wanStaticGateway?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  wanStaticDns?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  wanPppoeUsername?: string;

  @IsOptional()
  @IsString()
  wanPppoePassword?: string;
}
