import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class SyncNodeVlanDto {
  /** Interfaz física (o bridge) del router sobre la que debe existir la VLAN, ej. "ether5" (típicamente el puerto que conecta a la OLT). */
  @IsString()
  @IsNotEmpty()
  uplinkInterface: string;

  /** IP de gateway para esta VLAN en este nodo, formato RouterOS (ej. "10.20.0.1/24"). Opcional: algunas VLANs de solo paso no necesitan IP en este nodo. */
  @IsString()
  @IsOptional()
  gatewayCidr?: string;
}
