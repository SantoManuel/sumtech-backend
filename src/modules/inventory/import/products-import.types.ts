export type ProductImportField =
  | 'nombre'
  | 'sku'
  | 'categoria'
  | 'proveedor'
  | 'marca'
  | 'modelo'
  | 'precioCosto'
  | 'precioVenta'
  | 'unidadMedida'
  | 'stockMinimo'
  | 'almacen'
  | 'requiereSerial'
  | 'descripcion';

/** Fila tal cual quedó tras el reconocimiento de columnas (todo texto crudo, sin normalizar). */
export interface ProductImportParsedRow extends Record<ProductImportField, string> {
  rowNumber: number;
}

export interface CatalogOption {
  id: string;
  name: string;
}

export interface ProductImportRowAnalysis {
  row: ProductImportParsedRow;
  /** Si tiene al menos un elemento, la fila NO se puede importar tal cual (ver confirm()). */
  errors: string[];
  categoryResolved: boolean;
  supplierResolved: boolean;
  warehouseResolved: boolean;
}

export interface ProductsImportAnalysisResult {
  recognizedColumns: string[];
  totalRows: number;
  validRowsCount: number;
  invalidRowsCount: number;
  rows: ProductImportRowAnalysis[];
  /** Nombres de categoría que aparecen en el archivo pero no calzan con ninguna categoría existente. */
  unresolvedCategories: string[];
  unresolvedSuppliers: string[];
  unresolvedWarehouses: string[];
  existingCategories: CatalogOption[];
  existingSuppliers: CatalogOption[];
  existingWarehouses: CatalogOption[];
}

export interface ProductImportRowResult {
  rowNumber: number;
  status: 'created' | 'skipped' | 'error';
  message?: string;
  productId?: string;
}

export interface ProductsImportConfirmResult {
  totalRows: number;
  created: number;
  skipped: number;
  failed: number;
  results: ProductImportRowResult[];
}
