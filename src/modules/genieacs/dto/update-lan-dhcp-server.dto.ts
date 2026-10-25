import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Edición del servidor DHCP de la LAN -- ver plan §3.5. Riesgo alto: un rango mal puesto desconecta a todo el LAN del cliente, no solo internet. */
export class UpdateLanDhcpServerDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(IPV4_PATTERN, { message: 'La dirección mínima del rango debe ser una IPv4 válida.' })
  minAddress?: string;

  @IsOptional()
  @IsString()
  @Matches(IPV4_PATTERN, { message: 'La dirección máxima del rango debe ser una IPv4 válida.' })
  maxAddress?: string;

  @IsOptional()
  @IsString()
  @Matches(IPV4_PATTERN, { message: 'La máscara de subred debe ser una IPv4 válida.' })
  subnetMask?: string;

  @IsOptional()
  @IsString()
  @Matches(IPV4_PATTERN, { message: 'DNS 1 debe ser una IPv4 válida.' })
  dns1?: string;

  @IsOptional()
  @IsString()
  @Matches(IPV4_PATTERN, { message: 'DNS 2 debe ser una IPv4 válida.' })
  dns2?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64, { message: 'El nombre de dominio debe tener entre 1 y 64 caracteres.' })
  domainName?: string;

  @IsOptional()
  @IsString()
  @Matches(IPV4_PATTERN, { message: 'El gateway (IPRouters) debe ser una IPv4 válida.' })
  ipRouters?: string;
}
