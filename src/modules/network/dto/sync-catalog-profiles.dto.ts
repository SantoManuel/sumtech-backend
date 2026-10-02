import { IsArray, IsOptional, IsString, IsBoolean } from 'class-validator';

export class SyncCatalogProfilesDto {
  /** Lista opcional de IDs de planes comerciales para sincronización selectiva. Si se omite, sincroniza todos los planes activos. */
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  planIds?: string[];

  /** Sobrescribe el pool de IPs predeterminado del nodo para este lote de perfiles. */
  @IsString()
  @IsOptional()
  poolOverride?: string;

  /** Sobrescribe la cola padre predeterminada del nodo para este lote de perfiles. */
  @IsString()
  @IsOptional()
  parentQueueOverride?: string;

  /** Indica si se debe asegurar la existencia del perfil de suspensión preventiva 'Sumtech-Corte' (256k/256k). Por defecto: true. */
  @IsBoolean()
  @IsOptional()
  includeSuspensionProfile?: boolean;
}
