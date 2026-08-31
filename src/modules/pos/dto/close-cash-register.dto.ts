/**
 * ARCHIVO: src/modules/pos/dto/close-cash-register.dto.ts
 * RESPONSABILIDAD: Validación al realizar el cierre y arqueo de caja.
 * PROPIEDADES:
 * - cashRegisterId: string (@IsUUID)
 * - realClosingAmount: number (@IsNumber, @Min(0))
 * - notes?: string (@IsOptional)
 */
export {};
