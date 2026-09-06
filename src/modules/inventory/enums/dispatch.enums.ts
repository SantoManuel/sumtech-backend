/**
 * ARCHIVO: src/modules/inventory/enums/dispatch.enums.ts
 * RESPONSABILIDAD: Estados del Despacho por Lotes / Manifiesto de Carga.
 */
export enum DispatchStatus {
  DRAFT = 'DRAFT',
  DISPATCHED = 'DISPATCHED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export enum DispatchLineType {
  EQUIPMENT = 'EQUIPMENT',
  CONSUMABLE = 'CONSUMABLE',
}
