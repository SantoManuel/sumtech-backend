import { IsNotEmpty, IsPositive, IsOptional, IsString, IsUUID } from 'class-validator';

export class OpenCashRegisterDto {
  @IsNotEmpty()
  @IsPositive()
  openingAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;

  // Caja física en la que se abre el turno — opcional: si no se especifica,
  // el service intenta usar la caja por defecto del empleado (ver
  // PosService.openCashRegister).
  @IsOptional()
  @IsUUID('4')
  cashStationId?: string;
}

export class CloseCashRegisterDto {
  @IsNotEmpty()
  @IsPositive()
  realClosingAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
