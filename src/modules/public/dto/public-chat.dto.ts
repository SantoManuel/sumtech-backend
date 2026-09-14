import { IsNotEmpty, IsString, IsOptional, IsEmail, IsUUID, MaxLength, Matches } from 'class-validator';

/**
 * Formulario previo al chat público del landing. Se pide nombre + teléfono
 * antes de conversar (no se deja que la IA "detecte" cuándo es un prospecto
 * real) para garantizar que toda conversación del widget genere un Lead
 * rastreable en el CRM desde el primer mensaje.
 */
export class StartPublicChatDto {
  @IsNotEmpty({ message: 'El nombre es requerido' })
  @IsString()
  @MaxLength(100, { message: 'El nombre es demasiado largo (máx. 100 caracteres)' })
  name: string;

  @IsNotEmpty({ message: 'El teléfono es requerido' })
  @IsString()
  @Matches(/^[\d\s\-+()]{7,20}$/, { message: 'Formato de teléfono inválido' })
  phone: string;

  @IsOptional()
  @IsEmail({}, { message: 'Formato de correo inválido' })
  @MaxLength(100)
  email?: string;

  /**
   * Honeypot anti-bot: campo invisible en el formulario real (CSS
   * display:none, fuera del flujo de tabulación). Un humano nunca lo llena;
   * un bot que autocompleta todos los inputs de un formulario sí. Se llama
   * "website" a propósito (no "honeypot") para no delatar su función a un
   * bot que inspeccione el HTML.
   *
   * Deliberadamente SIN un validador que lo rechace (nada de @IsEmpty): si
   * viene lleno, se detecta y maneja en el servicio devolviendo un éxito
   * falso (200) en vez de un 400 — un error de validación le confirmaría al
   * bot que su envío fue detectado, permitiéndole ajustar el ataque.
   */
  @IsOptional()
  @IsString()
  website?: string;
}

export class SendPublicChatMessageDto {
  @IsNotEmpty({ message: 'El identificador de sesión es requerido' })
  @IsUUID('4', { message: 'Identificador de sesión inválido' })
  sessionId: string;

  @IsNotEmpty({ message: 'El mensaje no puede estar vacío' })
  @IsString()
  @MaxLength(1000, { message: 'El mensaje es demasiado largo (máx. 1000 caracteres)' })
  message: string;
}

export interface PublicChatStartResult {
  sessionId: string;
  isReturning: boolean;
}

export interface PublicChatMessageResult {
  message: string;
  timestamp: string;
}
