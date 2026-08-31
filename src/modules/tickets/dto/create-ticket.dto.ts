/**
 * ARCHIVO: src/modules/tickets/dto/create-ticket.dto.ts
 * RESPONSABILIDAD: Validación al registrar manualmente una avería o solicitud técnica.
 * PROPIEDADES:
 * - clientId: string (@IsUUID)
 * - contractId?: string (@IsOptional, @IsUUID)
 * - type: 'INSTALLATION' | 'REPAIR_FAULT' | 'MAINTENANCE' | 'DISCONNECTION' (@IsEnum)
 * - priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' (@IsOptional, @IsEnum)
 * - title: string (@IsNotEmpty)
 * - description: string (@IsNotEmpty)
 * - assignedEmployeeId?: string (@IsOptional, @IsUUID)
 */
export {};
