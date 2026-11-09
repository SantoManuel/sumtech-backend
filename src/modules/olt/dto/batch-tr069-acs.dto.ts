import {
  IsArray,
  ArrayMinSize,
  IsString,
  IsOptional,
  IsUUID,
  ValidateNested,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CustomAcsDto {
  @IsString()
  @MaxLength(255)
  @Matches(/^https?:\/\/[^\s]+$/, {
    message: 'La URL del ACS debe comenzar con http:// o https:// y no contener espacios.',
  })
  acsUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_@.+,=!?%$*:/-]+$/, {
    message: 'El usuario del ACS contiene caracteres no permitidos.',
  })
  tr069AcsUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_@.+,=!?%$*:/-]+$/, {
    message: 'La contraseña del ACS contiene caracteres no permitidos.',
  })
  tr069AcsPassword?: string;
}

export class BatchTr069AcsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe seleccionar al menos una ONU para migrar.' })
  @IsUUID('4', { each: true, message: 'Cada ID de ONU debe ser un UUID válido.' })
  onuIds: string[];

  @IsOptional()
  @IsUUID('4', { message: 'El ID de la red TR-069 debe ser un UUID válido.' })
  tr069NetworkId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomAcsDto)
  customAcs?: CustomAcsDto;
}
