export type SerialImportField = 'producto' | 'serial' | 'mac' | 'almacen';

export interface SerialImportParsedRow extends Record<SerialImportField, string> {
  rowNumber: number;
}

export interface CatalogOption {
  id: string;
  name: string;
  sku: string;
  requiresSerial: boolean;
}

export interface SerialImportRowAnalysis {
  row: SerialImportParsedRow;
  /** Si tiene al menos un elemento, la fila NO se puede importar tal cual (ver confirm()). */
  errors: string[];
  productResolved: boolean;
  warehouseResolved: boolean;
}

export interface SerialsImportAnalysisResult {
  recognizedColumns: string[];
  totalRows: number;
  validRowsCount: number;
  invalidRowsCount: number;
  rows: SerialImportRowAnalysis[];
  /** Texto de producto (SKU o nombre) que aparece en el archivo pero no calza con ningún producto serializable existente. */
  unresolvedProducts: string[];
  unresolvedWarehouses: string[];
  existingProducts: CatalogOption[];
  existingWarehouses: { id: string; name: string }[];
}

export interface SerialImportRowResult {
  rowNumber: number;
  status: 'created' | 'skipped' | 'error';
  message?: string;
  equipmentId?: string;
}

export interface SerialsImportConfirmResult {
  totalRows: number;
  created: number;
  skipped: number;
  failed: number;
  results: SerialImportRowResult[];
}
