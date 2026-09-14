import { IsNotEmpty, IsString, IsOptional, IsInt, IsBoolean, Min, Max, IsUUID, MaxLength } from 'class-validator';

export class CreateNetworkNodeDto {
  @IsNotEmpty({ message: 'El nombre del nodo es requerido' })
  @IsString()
  @MaxLength(150, { message: 'El nombre del nodo no puede superar 150 caracteres' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'El modelo no puede superar 100 caracteres' })
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(45, { message: 'La IP de gestión no puede superar 45 caracteres' })
  managementIp?: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'El puerto de la API debe ser mayor a 0' })
  @Max(65535, { message: 'El puerto de la API no puede superar 65535' })
  apiPort?: number;

  @IsOptional()
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido' })
  zoneId?: string;

  // Falso solo para nodos que todavía no tienen www-ssl con certificado
  // configurado (ej. un CHR de prueba recién instalado) — la REST API se
  // consulta por HTTP plano en ese caso. Verdadero por defecto.
  @IsOptional()
  @IsBoolean()
  useHttps?: boolean;

  // provisioningMode NO se acepta al crear: todo nodo nuevo nace en MANUAL a
  // propósito (decisión de negocio — ver Fase 05/06 del plan de integración
  // con RouterOS). Pasar a ROUTEROS es una acción explícita posterior vía
  // NetworkNodesService.update, nunca algo que se pueda colar en el alta.
}
