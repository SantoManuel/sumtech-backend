import { IsString, IsOptional, IsBoolean, IsInt, Min, Max, MaxLength } from 'class-validator';

export class UpdateMailSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  smtpUser?: string;

  /** Texto plano — se cifra vía transformer de columna al guardar. Vacío/omitido = no tocar la contraseña ya guardada. */
  @IsOptional()
  @IsString()
  smtpPass?: string;

  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  /** Texto libre tipo `"Mi ISP <no-reply@miisp.com>"` — no se valida como email puro a propósito. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromAddress?: string;
}
