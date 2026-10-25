import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export interface OnuTr069VendorToggle {
  parameterKey: string;
  label: string;
  category: 'SECURITY' | 'MISCELLANEOUS';
  value?: boolean;
}

/** Alta de un parámetro al catálogo -- SOLO tras confirmarlo en vivo contra un equipo real (ver migración 096). */
export class CreateCpeVendorParameterDto {
  @IsString()
  @Length(1, 100)
  vendor: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  modelPattern?: string;

  @IsIn(['SECURITY', 'MISCELLANEOUS'])
  category: 'SECURITY' | 'MISCELLANEOUS';

  @IsString()
  @Length(1, 100)
  parameterKey: string;

  @IsString()
  @Length(1, 150)
  label: string;

  @IsString()
  @Length(1, 500)
  oidPath: string;

  @IsOptional()
  @IsString()
  dataType?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SetVendorToggleDto {
  @IsBoolean()
  value: boolean;
}
