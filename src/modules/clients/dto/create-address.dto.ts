/**
 * ARCHIVO: src/modules/clients/dto/create-address.dto.ts
 * RESPONSABILIDAD: Validación al registrar una dirección de instalación física.
 * PROPIEDADES:
 * - street: string (@IsNotEmpty)
 * - buildingNumber?: string (@IsOptional)
 * - sector: string (@IsNotEmpty)
 * - municipality: string (@IsNotEmpty)
 * - city: string (@IsNotEmpty)
 * - gpsLatitude?: number (@IsOptional, @IsLatitude)
 * - gpsLongitude?: number (@IsOptional, @IsLongitude)
 * - reference?: string (@IsOptional)
 * - isPrimary?: boolean (@IsOptional, @IsBoolean)
 */
export {};
