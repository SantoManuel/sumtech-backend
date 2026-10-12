import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class EnsurePppoeServerDto {
  /** Nombre del servicio PPPoE (ej. "pppoe-vlan400"). Si se omite, se usa "pppoe-vlan<vlanId>". */
  @IsOptional()
  @IsString()
  serviceName?: string;

  /** Perfil por defecto en RouterOS para este servidor (ej. "default" o perfil del catálogo). */
  @IsOptional()
  @IsString()
  defaultProfile?: string;

  /** Permitir solo una sesión por host MAC (por defecto true). */
  @IsOptional()
  @IsBoolean()
  oneSessionPerHost?: boolean;

  /** Métodos de autenticación aceptados (ej. "pap,chap,mschap2"). Opcional. */
  @IsOptional()
  @IsString()
  authentication?: string;
}
