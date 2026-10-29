import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional, IsBoolean, IsIn, Length } from 'class-validator';

export class CreateOnuTypeDto {
  @IsString()
  @IsNotEmpty({ message: 'El fabricante es obligatorio' })
  @Length(1, 50)
  vendor: string;

  @IsString()
  @IsNotEmpty({ message: 'El modelo es obligatorio' })
  @Length(1, 50)
  model: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre real del tipo en el firmware de la OLT es obligatorio' })
  @Length(1, 100)
  vendorTypeName: string;

  @IsIn(['GPON', 'EPON'], { message: 'El tipo de PON debe ser GPON o EPON' })
  ponType: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16)
  ethPorts?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16)
  potsPorts?: number;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  wifiBands?: string;

  @IsOptional()
  @IsBoolean()
  catvPort?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsTr069?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsOmci?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsBridge?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsRouter?: boolean;

  @IsOptional()
  @IsIn(['ROUTER', 'BRIDGE'])
  defaultMode?: 'ROUTER' | 'BRIDGE';

  @IsOptional()
  @IsBoolean()
  supportsEthuniDhcpDelegation?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsSecurityMgmt?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOnuTypeDto {
  @IsOptional()
  @IsString()
  @Length(1, 50)
  vendor?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  model?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  vendorTypeName?: string;

  @IsOptional()
  @IsIn(['GPON', 'EPON'], { message: 'El tipo de PON debe ser GPON o EPON' })
  ponType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16)
  ethPorts?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(16)
  potsPorts?: number;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  wifiBands?: string;

  @IsOptional()
  @IsBoolean()
  catvPort?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsTr069?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsOmci?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsBridge?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsRouter?: boolean;

  @IsOptional()
  @IsIn(['ROUTER', 'BRIDGE'])
  defaultMode?: 'ROUTER' | 'BRIDGE';

  @IsOptional()
  @IsBoolean()
  supportsEthuniDhcpDelegation?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsSecurityMgmt?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
