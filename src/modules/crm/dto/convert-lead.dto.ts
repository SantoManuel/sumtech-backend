/**
 * ARCHIVO: src/modules/crm/dto/convert-lead.dto.ts
 * RESPONSABILIDAD: Validación al convertir un prospecto en cliente formal de Sumtech.
 * PROPIEDADES:
 * - docType: 'CEDULA' | 'RNC' | 'PASAPORTE' (@IsEnum)
 * - docNumber: string (@IsNotEmpty)
 * - clientType: 'FISICA' | 'JURIDICA' (@IsEnum)
 * - address: CreateAddressDto (@ValidateNested)
 */
export {};
