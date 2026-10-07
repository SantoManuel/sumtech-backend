import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class RecordManualPaymentDto {
  @IsOptional()
  @IsInt({ message: 'Los meses a renovar deben ser un número entero' })
  @Min(1, { message: 'Debe añadir al menos 1 mes' })
  @Max(36, { message: 'No puede exceder 36 meses (3 años)' })
  monthsToAdd?: number = 1;

  @IsNotEmpty({ message: 'La referencia o comprobante de pago es obligatoria' })
  @IsString({ message: 'La referencia debe ser una cadena de texto' })
  paymentReference: string;

  @IsOptional()
  @IsNumber({}, { message: 'El monto pagado debe ser un número válido' })
  @Min(0, { message: 'El monto pagado no puede ser negativo' })
  amountPaid?: number;

  @IsOptional()
  @IsString({ message: 'Las notas deben ser una cadena de texto' })
  notes?: string;
}
