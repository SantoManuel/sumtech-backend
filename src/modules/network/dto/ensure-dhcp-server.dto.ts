import { IsString, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator';

export class EnsureDhcpServerDto {
  /** Rango de IPs para el pool DHCP, formato RouterOS (ej. "10.20.0.10-10.20.0.250"). */
  @IsString()
  @IsNotEmpty()
  poolRange: string;

  @IsOptional()
  @IsString()
  dnsServers?: string;

  @IsOptional()
  @IsInt()
  @Min(60)
  leaseTimeSec?: number;
}
