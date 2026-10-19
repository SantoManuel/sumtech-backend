import { IsInt, IsString, IsOptional, IsNotEmpty, Min, Max } from 'class-validator';

export class ImportDiscoveredVlanDto {
  /** Número de VLAN real descubierto en el router (ver scanRealVlans). */
  @IsInt()
  @Min(1)
  @Max(4094)
  vlanId: number;

  /** Interfaz física real sobre la que vive esa sub-interfaz VLAN en el router (ej. "ether5"). */
  @IsString()
  @IsNotEmpty()
  interfaceName: string;

  /** IP de gateway real detectada en esa sub-interfaz, si la tenía (formato RouterOS, ej. "10.20.0.1/24"). */
  @IsString()
  @IsOptional()
  gatewayCidr?: string;
}
