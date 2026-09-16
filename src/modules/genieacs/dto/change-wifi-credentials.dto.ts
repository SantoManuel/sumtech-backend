import { IsNotEmpty, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

// Letras (con acentos/ñ), números, espacios, guiones, puntos y guion bajo —
// cubre nombres de red reales sin abrir la puerta a caracteres de control.
const SSID_PATTERN = /^[\p{L}\p{N} _.-]+$/u;
// ASCII imprimible únicamente — el rango real que WPA2/WPA3 acepta de forma
// confiable en cualquier CPE, evitando problemas de codificación en el SOAP/TR-069.
const WIFI_PASSWORD_PATTERN = /^[\x20-\x7E]+$/;

export class ChangeWifiCredentialsDto {
  @IsUUID('4', { message: 'contractId debe ser un UUID válido' })
  contractId: string;

  @IsNotEmpty({ message: 'Debes confirmar tu contraseña actual.' })
  currentAccountPassword: string;

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
  newPassword: string;
}
