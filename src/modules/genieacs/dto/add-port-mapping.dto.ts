import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Nueva regla de Port Forward -- ver plan §3.3. */
export class AddPortMappingDto {
  @IsIn(['TCP', 'UDP'], { message: 'El protocolo debe ser TCP o UDP.' })
  protocol: 'TCP' | 'UDP';

  @IsInt()
  @Min(1, { message: 'El puerto externo debe estar entre 1 y 65535.' })
  @Max(65535, { message: 'El puerto externo debe estar entre 1 y 65535.' })
  externalPort: number;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'El fin de rango del puerto externo debe estar entre 1 y 65535.' })
  @Max(65535, { message: 'El fin de rango del puerto externo debe estar entre 1 y 65535.' })
  externalPortEndRange?: number;

  @IsInt()
  @Min(1, { message: 'El puerto interno debe estar entre 1 y 65535.' })
  @Max(65535, { message: 'El puerto interno debe estar entre 1 y 65535.' })
  internalPort: number;

  @IsString()
  @Matches(IPV4_PATTERN, { message: 'El cliente interno debe ser una dirección IPv4 válida de la LAN del cliente.' })
  internalClient: string;

  @IsOptional()
  @IsString()
  @Length(1, 64, { message: 'La descripción debe tener entre 1 y 64 caracteres.' })
  description?: string;
}
