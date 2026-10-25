import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * Edición de una radio WiFi (más allá de SSID/password, que ya gestiona
 * `setWifiCredentials`) -- ver plan §3.8. Standard/ChannelWidth/TxPower
 * quedan fuera a propósito (extensiones de fabricante sin OID confirmado,
 * ver OnuTr069WirelessLanEntry).
 */
export class UpdateWirelessLanDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  ssidAdvertisementEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'El canal debe ser un número entre 1 y 165.' })
  @Max(165, { message: 'El canal debe ser un número entre 1 y 165.' })
  channel?: number;

  @IsOptional()
  @IsBoolean()
  autoChannelEnabled?: boolean;

  @IsOptional()
  @IsString()
  @Length(2, 2, { message: 'El dominio regulatorio debe ser un código de país ISO de 2 letras (ej. "DO").' })
  regulatoryDomain?: string;
}
