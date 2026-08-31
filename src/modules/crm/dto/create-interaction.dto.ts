/**
 * ARCHIVO: src/modules/crm/dto/create-interaction.dto.ts
 * RESPONSABILIDAD: Validación al registrar una llamada, nota o visita con el suscriptor.
 * PROPIEDADES:
 * - clientId: string (@IsUUID)
 * - channel: 'PHONE_CALL' | 'EMAIL' | 'WHATSAPP' | 'IN_PERSON' (@IsEnum)
 * - subject: string (@IsNotEmpty)
 * - notes: string (@IsNotEmpty)
 * - nextFollowUpDate?: string (@IsOptional, @IsDateString)
 */
export {};
