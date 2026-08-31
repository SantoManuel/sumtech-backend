/**
 * ARCHIVO: src/modules/crm/dto/create-lead.dto.ts
 * RESPONSABILIDAD: Validación al registrar un prospecto desde fuentes comerciales.
 * PROPIEDADES:
 * - name: string (@IsNotEmpty)
 * - phone: string (@IsNotEmpty)
 * - email?: string (@IsOptional, @IsEmail)
 * - planId?: string (@IsOptional, @IsUUID)
 * - source?: 'WEB_LANDING' | 'CALL_INBOUND' | 'WHATSAPP' | 'FLYER'
 * - notes?: string (@IsOptional)
 */
export {};
