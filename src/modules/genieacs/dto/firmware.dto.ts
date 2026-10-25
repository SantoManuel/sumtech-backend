import { IsOptional, IsString, Length } from 'class-validator';

export class UploadFirmwareMetadataDto {
  @IsString()
  @Length(1, 100)
  vendor: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  modelPattern?: string;

  @IsString()
  @Length(1, 100)
  version: string;
}

/**
 * Doble confirmación obligatoria (§2.4 del plan): el ADMIN debe re-escribir
 * la versión destino exacta -- no basta un simple "¿Confirmar?" para una
 * acción que puede dejar el equipo inoperable.
 */
export class PushFirmwareDto {
  @IsString()
  confirmVersion: string;
}
