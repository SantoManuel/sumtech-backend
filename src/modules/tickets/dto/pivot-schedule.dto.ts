import { 
  IsNotEmpty, 
  IsOptional, 
  IsArray, 
  IsUUID, 
  Matches, 
  IsEnum, 
  IsString 
} from 'class-validator';

export class PivotScheduleDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Cada ID de ticket debe ser un UUID válido' })
  ticketIds?: string[];

  @IsNotEmpty({ message: 'La fecha origen es obligatoria (YYYY-MM-DD)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha origen debe tener formato YYYY-MM-DD' })
  sourceDate: string;

  @IsNotEmpty({ message: 'La fecha destino es obligatoria (YYYY-MM-DD)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha destino debe tener formato YYYY-MM-DD' })
  targetDate: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Cada ID de técnico debe ser un UUID válido' })
  technicianIds?: string[];

  @IsOptional()
  @IsEnum(['SHIFT_PRESERVE_HOURS', 'RESEQUENCE'], {
    message: 'El modo de pivotado debe ser SHIFT_PRESERVE_HOURS o RESEQUENCE',
  })
  mode?: 'SHIFT_PRESERVE_HOURS' | 'RESEQUENCE';

  @IsOptional()
  @IsString()
  reason?: string;
}
