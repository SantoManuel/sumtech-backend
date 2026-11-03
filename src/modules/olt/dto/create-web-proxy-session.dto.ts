import { IsIP, IsOptional } from 'class-validator';

export class CreateWebProxySessionDto {
  /**
   * IP de gestión conocida por el operador, usada cuando la ONU no reporta a
   * GenieACS (sin contacto TR-069) ni tiene WAN estática configurada. Se
   * persiste en serviceConfig.tr069Ip para que las próximas sesiones no
   * vuelvan a pedirla.
   */
  @IsOptional() @IsIP('4') manualIp?: string;
}
