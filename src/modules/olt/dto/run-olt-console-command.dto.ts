import { IsString, Length } from 'class-validator';

export class RunOltConsoleCommandDto {
  @IsString()
  @Length(1, 2000, { message: 'El comando debe tener entre 1 y 2000 caracteres.' })
  command: string;
}
