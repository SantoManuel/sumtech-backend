/**
 * Fila del export legacy relevante para IMPORTAR CLIENTES (no red). Las
 * columnas Usuario/Servicio/Ip/Router/Zona/Acción del mismo archivo son
 * responsabilidad de src/database/scripts/legacy-network-import (Fase 04 del
 * plan de integración), que corre DESPUÉS de esta importación — busca el
 * contrato por el mismo docNumber que aquí se crea.
 */
export interface LegacyClientRow {
  /** 1-based, contando el encabezado como fila 1 — para señalar la fila exacta en el reporte de errores. */
  rowNumber: number;
  nombre: string;
  docNumber: string;
  telefono: string;
  direccion: string;
  barrio: string;
  ciudadMunicipio: string;
  coordenadas: string;
  estado: string;
  planInternet: string;
  fechaInstalacion: string;
  saldo: string;
}

export interface LegacyClientParseResult {
  rows: LegacyClientRow[];
  recognizedColumns: string[];
}
