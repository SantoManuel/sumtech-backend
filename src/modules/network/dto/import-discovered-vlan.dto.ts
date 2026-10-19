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

  /** Nombre REAL de la propia sub-interfaz VLAN en RouterOS (ver scanRealVlans) -- distinto de interfaceName (el puerto físico padre). Necesario para poder buscar servidores PPPoE/DHCP sobre ella más adelante. */
  @IsString()
  @IsOptional()
  vlanInterfaceName?: string;

  /** IP de gateway real detectada en esa sub-interfaz, si la tenía (formato RouterOS, ej. "10.20.0.1/24"). */
  @IsString()
  @IsOptional()
  gatewayCidr?: string;
}
