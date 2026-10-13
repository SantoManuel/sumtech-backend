import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreateRouterOsProfileDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  /** Formato RouterOS tipo '20M/20M' o '10M/50M' (Upload/Download) */
  @IsString()
  @IsNotEmpty()
  rateLimit: string;

  @IsString()
  @IsOptional()
  parentQueue?: string;

  /** IP del Gateway local en el extremo del router para el túnel PPP (ej. 100.64.0.1) */
  @IsString()
  @IsOptional()
  localAddress?: string;

  /** Nombre del IP Pool de asignación dinámica de clientes (ej. pool-residencial) o IP remota */
  @IsString()
  @IsOptional()
  remoteAddress?: string;

  @IsBoolean()
  @IsOptional()
  onlyOne?: boolean;

  /** Servidores DNS entregados al cliente por IPCP (ej. "8.8.8.8,1.1.1.1"). Sin esto el cliente no puede resolver nombres de dominio (ej. para TR-069/ACS). */
  @IsString()
  @IsOptional()
  dnsServer?: string;
}

export class UpdateRouterOsProfileDto {
  @IsString()
  @IsOptional()
  rateLimit?: string;

  @IsString()
  @IsOptional()
  parentQueue?: string;

  @IsString()
  @IsOptional()
  localAddress?: string;

  @IsString()
  @IsOptional()
  remoteAddress?: string;

  @IsBoolean()
  @IsOptional()
  onlyOne?: boolean;

  @IsString()
  @IsOptional()
  dnsServer?: string;
}
