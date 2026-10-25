import { IsBoolean } from 'class-validator';

/** Habilita/deshabilita un puerto Ethernet físico -- ver plan §3.6. Riesgo medio: deshabilitar el puerto equivocado corta el LAN del cliente en ese puerto. */
export class ToggleLanPortDto {
  @IsBoolean()
  enabled: boolean;
}
