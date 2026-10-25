import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

// TR-069 Username/Password son texto ASCII imprimible libre -- mismo criterio
// que ya usa StaffChangeWifiCredentialsDto para la clave WiFi.
const ASCII_PRINTABLE_PATTERN = /^[\x20-\x7E]+$/;
const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * Edición de la interfaz PPP (WAN PPPoE) desde la pestaña TR-069/GenieACS --
 * ver Plan_Implementacion_Pestana_TR069_Avanzada_ONU.md §3.2. serviceName,
 * connectionTrigger y dns1/dns2 son conceptos de TR-098 que TR-181 no
 * estandariza en PPP.Interface -- si se envían contra un equipo TR-181, el
 * backend los ignora y lo informa en la respuesta (`skippedFields`), nunca
 * falla en silencio ni inventa un parámetro que no existe.
 */
export class UpdatePppInterfaceDto {
  @IsOptional()
  @IsString()
  @Length(1, 128, { message: 'El usuario PPPoE debe tener entre 1 y 128 caracteres.' })
  @Matches(ASCII_PRINTABLE_PATTERN, { message: 'El usuario PPPoE solo puede tener caracteres ASCII imprimibles.' })
  username?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128, { message: 'La contraseña PPPoE debe tener entre 1 y 128 caracteres.' })
  @Matches(ASCII_PRINTABLE_PATTERN, { message: 'La contraseña PPPoE solo puede tener caracteres ASCII imprimibles.' })
  password?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64, { message: 'El nombre de servicio debe tener entre 1 y 64 caracteres.' })
  serviceName?: string;

  @IsOptional()
  @IsIn(['AlwaysOn', 'OnDemand', 'Manual'], { message: 'El disparador de conexión debe ser AlwaysOn, OnDemand o Manual.' })
  connectionTrigger?: 'AlwaysOn' | 'OnDemand' | 'Manual';

  @IsOptional()
  @IsString()
  @Matches(IPV4_PATTERN, { message: 'DNS 1 debe ser una dirección IPv4 válida.' })
  dns1?: string;

  @IsOptional()
  @IsString()
  @Matches(IPV4_PATTERN, { message: 'DNS 2 debe ser una dirección IPv4 válida.' })
  dns2?: string;
}
