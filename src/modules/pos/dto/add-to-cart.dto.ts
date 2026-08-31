/**
 * ARCHIVO: src/modules/pos/dto/add-to-cart.dto.ts
 * RESPONSABILIDAD: Validación para agregar un plan o equipo al carrito temporal en Redis.
 * PROPIEDADES:
 * - cartId: string (@IsUUID)
 * - itemType: 'PLAN_ACTIVATION' | 'PRODUCT_HARDWARE' | 'INSTALLATION_FEE' (@IsEnum)
 * - itemId: string (@IsUUID)
 * - quantity: number (@IsInt, @Min(1))
 */
export {};
