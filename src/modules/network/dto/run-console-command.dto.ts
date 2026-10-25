import { IsString, Length } from 'class-validator';

/** Consola RouterOS -- acceso de shell real sin restricciones, SOLO rol ADMIN (ver NetworkNodesController). */
export class RunConsoleCommandDto {
  @IsString()
  @Length(1, 2000, { message: 'El comando debe tener entre 1 y 2000 caracteres.' })
  command: string;
}
