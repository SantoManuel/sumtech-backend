export type LegacyConnectionStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CUT';

/** Una fila del export del sistema WISP anterior, ya mapeada por nombre de columna. */
export interface LegacyNetworkRow {
  /** 1-based, contando el encabezado como fila 1 — para poder señalar la fila exacta en un reporte de excepciones. */
  rowNumber: number;
  usuario: string;
  nombre: string;
  servicio: string;
  ip: string;
  estado: string;
  planInternet: string;
  router: string;
  zona: string;
  docNumber: string;
  direccion: string;
  barrio: string;
  telefono: string;
  saldo: string;
  fechaInstalacion: string;
  coordenadas: string;
  ciudadMunicipio: string;
}

export interface ClientLookupEntry {
  clientId: string;
  docNumber: string;
  /** Solo contratos no TERMINATED — un contrato terminado no recibe configuración de red nueva. */
  contracts: { contractId: string; contractNumber: string }[];
}

export interface ImportPlanItem {
  rowNumber: number;
  clientId: string;
  contractId: string;
  contractNumber: string;
  zoneName?: string;
  nodeName?: string;
  username?: string;
  serviceAlias?: string;
  ipAddress?: string;
  connectionStatus: LegacyConnectionStatus;
}

export interface ImportException {
  rowNumber: number;
  docNumber: string;
  reason: string;
}

export interface ImportPlan {
  items: ImportPlanItem[];
  exceptions: ImportException[];
}
