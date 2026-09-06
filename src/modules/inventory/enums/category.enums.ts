/**
 * ARCHIVO: src/modules/inventory/enums/category.enums.ts
 * RESPONSABILIDAD: Eje de clasificación de CategoryEntity.
 *
 * Determina cómo se comporta un producto dentro del motor de trazabilidad:
 * - CUSTOMER_EQUIPMENT: se instala en el contrato de un cliente (ONU, router, STB).
 * - TOOL_ASSET: herramienta de trabajo; EquipmentMovementService.instalarEnCliente
 *   la rechaza explícitamente (fusionadora, OTDR, escalera).
 * - CONSUMABLE: material a granel, se maneja por cantidad (fibra, conectores).
 */
export enum ArticleType {
  CUSTOMER_EQUIPMENT = 'CUSTOMER_EQUIPMENT',
  TOOL_ASSET = 'TOOL_ASSET',
  FIXED_ASSET = 'FIXED_ASSET',
  CONSUMABLE = 'CONSUMABLE',
}
