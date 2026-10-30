import { IsInt, IsString, IsOptional, IsNotEmpty, IsIn, Min, Max } from 'class-validator';

export class ImportDiscoveredVlanDto {
  /** Número de VLAN real descubierto en el router (ver scanRealVlans). */
  @IsInt()
  @Min(1)
  @Max(4094)
  vlanId: number;

  /**
   * Tipo real de la VLAN (ver VlanEntity.type) -- el operador lo elige al
   * importar, en vez de que el backend asuma siempre "INTERNET". Bug real
   * confirmado (2026-10-30): una VLAN de gestión TR-069 importada así
   * quedaba mal clasificada como "INTERNET", lo que podía confundir el
   * autoselect de "VLAN de Servicio" en OnuAuthorizeModal.
   */
  @IsString()
  @IsOptional()
  @IsIn(['INTERNET', 'IPTV', 'MGMT', 'TR069', 'VOIP'])
  type?: 'INTERNET' | 'IPTV' | 'MGMT' | 'TR069' | 'VOIP';

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
