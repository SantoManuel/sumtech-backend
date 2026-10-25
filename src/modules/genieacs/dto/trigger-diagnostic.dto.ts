import { IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

/**
 * Body del disparo de un diagnóstico TR-143 (§3.15/§3.10 del plan). Qué
 * campos son obligatorios depende del `type` de la URL -- validado en
 * `GenieAcsDiagnosticsService.triggerDiagnostic`, no acá, porque DTOs de
 * class-validator no expresan bien "requerido solo si type=X".
 */
export class TriggerDiagnosticDto {
  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'El número de repeticiones debe ser al menos 1.' })
  @Max(20, { message: 'El número de repeticiones no puede superar 20 (evita saturar el enlace del cliente).' })
  numberOfRepetitions?: number;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'La URL de descarga debe ser una URL válida.' })
  downloadUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'La URL de subida debe ser una URL válida.' })
  uploadUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1024, { message: 'El tamaño de archivo de prueba debe ser de al menos 1024 bytes.' })
  testFileLength?: number;
}
