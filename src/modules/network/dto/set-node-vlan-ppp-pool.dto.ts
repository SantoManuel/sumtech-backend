import { IsString, MaxLength } from 'class-validator';

export class SetNodeVlanPppPoolDto {
  /** Nombre del pool (/ip/pool) en RouterOS a usar para esta VLAN de este nodo. String vacío = quitar la asignación. */
  @IsString()
  @MaxLength(100, { message: 'El nombre del pool no puede superar 100 caracteres' })
  pppPool: string;
}
