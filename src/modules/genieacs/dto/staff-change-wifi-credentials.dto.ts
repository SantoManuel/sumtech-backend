import { IsOptional, IsString, Length, Matches } from 'class-validator';

// Mismos patrones que ChangeWifiCredentialsDto (autogestión del cliente) —
// ver ese archivo para el razonamiento de cada regex.
const SSID_PATTERN = /^[\p{L}\p{N} _.-]+$/u;
const WIFI_PASSWORD_PATTERN = /^[\x20-\x7E]+$/;

/**
 * Cambio de WiFi hecho por staff (ADMIN/GERENTE) desde el panel del cliente,
 * no por el cliente mismo — por eso no pide `currentAccountPassword` ni
 * `contractId` (ese viene de la URL): la sesión de staff ya es la
 * autorización. Ver GenieAcsController.
 */
export class StaffChangeWifiCredentialsDto {
  @IsString()
  @Length(1, 32, { message: 'El nombre de la red debe tener entre 1 y 32 caracteres.' })
  @Matches(SSID_PATTERN, {
    message: 'El nombre de la red solo puede tener letras, números, espacios, guiones y puntos.',
  })
  ssid: string;

  @IsOptional()
  @IsString()
  @Length(1, 32, { message: 'El nombre de la red de 5GHz debe tener entre 1 y 32 caracteres.' })
  @Matches(SSID_PATTERN, {
    message: 'El nombre de la red de 5GHz solo puede tener letras, números, espacios, guiones y puntos.',
  })
  ssid5g?: string;

  @IsString()
  @Length(8, 63, { message: 'La clave WiFi debe tener entre 8 y 63 caracteres.' })
  @Matches(WIFI_PASSWORD_PATTERN, {
    message: 'La clave WiFi solo puede contener letras, números y símbolos comunes (sin emojis ni caracteres especiales).',
  })
  password: string;
}
