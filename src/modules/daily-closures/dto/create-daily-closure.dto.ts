import { IsNumber, Min, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Los campos llegan como multipart/form-data (junto a las fotos), por lo que
 * `fuelAmount` viaja como string y se transforma a número. El arreglo
 * `expenses` (JSON de {concept, amount}[]) se valida a mano en el servicio —
 * class-validator no valida JSON anidado dentro de un campo de texto plano de
 * multipart sin un paso de parseo previo.
 */
export class CreateDailyClosureDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fuelAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;

  // JSON de {concept, amount}[] — declarado como string (no como arreglo
  // tipado) porque el ValidationPipe global whitelistea el body completo
  // contra este DTO antes de que el controller pueda leerlo por separado;
  // el parseo/validación real del contenido ocurre en el servicio.
  @IsString()
  expenses: string;
}

export interface DailyClosureExpenseInput {
  concept: string;
  amount: number;
}
