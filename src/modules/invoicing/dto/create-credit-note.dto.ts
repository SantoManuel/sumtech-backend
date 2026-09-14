import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCreditNoteDto {
  @IsNotEmpty({ message: 'El motivo de la anulación es requerido' })
  @IsString()
  @MaxLength(90, { message: 'El motivo no puede superar 90 caracteres (límite DGII para RazonModificacion)' })
  razonModificacion: string;
}
