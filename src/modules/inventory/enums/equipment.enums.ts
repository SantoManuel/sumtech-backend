/**
 * ARCHIVO: src/modules/inventory/enums/equipment.enums.ts
 * RESPONSABILIDAD: Enumeraciones del motor de trazabilidad de equipos (EquipmentItem).
 *
 * Se modelan DOS ejes de estado independientes porque un equipo puede combinarlos
 * (ej. con un técnico y a la vez dañado, esperando ser enviado a reparación):
 * - EquipmentLocationType: DÓNDE está físicamente / quién lo custodia.
 * - EquipmentCondition: EN QUÉ ESTADO FÍSICO se encuentra.
 */

export enum EquipmentLocationType {
  WAREHOUSE = 'WAREHOUSE',
  TECHNICIAN = 'TECHNICIAN',
  CLIENT = 'CLIENT',
  REPAIR_VENDOR = 'REPAIR_VENDOR',
  RETIRED = 'RETIRED',
  LOST = 'LOST',
}

export enum EquipmentCondition {
  NEW = 'NEW',
  GOOD = 'GOOD',
  DAMAGED = 'DAMAGED',
  DEFECTIVE = 'DEFECTIVE',
  IN_REPAIR = 'IN_REPAIR',
  SCRAPPED = 'SCRAPPED',
}

export enum EquipmentMovementType {
  INGRESO_ALMACEN = 'INGRESO_ALMACEN',
  ASIGNAR_A_TECNICO = 'ASIGNAR_A_TECNICO',
  INSTALAR_EN_CLIENTE = 'INSTALAR_EN_CLIENTE',
  DESINSTALAR = 'DESINSTALAR',
  DEVOLVER_A_ALMACEN = 'DEVOLVER_A_ALMACEN',
  TRANSFERIR_A_OTRO_TECNICO = 'TRANSFERIR_A_OTRO_TECNICO',
  REPORTAR_DANO = 'REPORTAR_DANO',
  ENVIAR_A_REPARACION = 'ENVIAR_A_REPARACION',
  RETORNAR_DE_REPARACION = 'RETORNAR_DE_REPARACION',
  DAR_DE_BAJA = 'DAR_DE_BAJA',
  AJUSTE_CONTEO_FISICO = 'AJUSTE_CONTEO_FISICO',
}

export type LegacySerialStatus = 'AVAILABLE' | 'RESERVED' | 'ASSIGNED_TO_CLIENT' | 'DAMAGED' | 'IN_REPAIR';

/**
 * Puente de compatibilidad: el frontend y endpoints legacy todavía leen `status`
 * (un solo enum). Se deriva automáticamente de locationType+condition en cada
 * movimiento para no romper esos consumidores mientras se migran (Fase 5).
 */
export function deriveLegacyStatus(
  locationType: EquipmentLocationType,
  condition: EquipmentCondition,
): LegacySerialStatus {
  if (condition === EquipmentCondition.DAMAGED || condition === EquipmentCondition.DEFECTIVE) {
    return 'DAMAGED';
  }
  if (condition === EquipmentCondition.IN_REPAIR || locationType === EquipmentLocationType.REPAIR_VENDOR) {
    return 'IN_REPAIR';
  }
  if (locationType === EquipmentLocationType.CLIENT) {
    return 'ASSIGNED_TO_CLIENT';
  }
  if (locationType === EquipmentLocationType.WAREHOUSE) {
    return 'AVAILABLE';
  }
  if (locationType === EquipmentLocationType.TECHNICIAN) {
    return 'RESERVED';
  }
  // RETIRED / LOST: no hay bucket legacy adecuado, se marca como no disponible.
  return 'DAMAGED';
}
