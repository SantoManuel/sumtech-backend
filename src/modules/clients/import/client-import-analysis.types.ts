export interface DistinctLocationSummary {
  legacyLocationKey: string;
  barrio: string;
  ciudadMunicipio: string;
  occurrences: number;
  /** Si ya viene resuelta (ej. reintento tras un análisis previo del mismo batch). */
  resolved: boolean;
}

export interface DistinctPlanSummary {
  raw: string;
  speedMbps: number | null;
  monthlyPrice: number | null;
  parseable: boolean;
  occurrences: number;
  /** true si ya existe un PlanEntity con esa velocidad+precio exactos. */
  matchesExistingPlan: boolean;
}

export interface ClientImportAnalysisResult {
  batchId: string;
  format: 'csv' | 'excel';
  totalRows: number;
  recognizedColumns: string[];
  distinctLocations: DistinctLocationSummary[];
  distinctPlans: DistinctPlanSummary[];
  /** Filas con documento o nombre vacío detectadas ya en el análisis — no procesables sin importar el mapeo de ubicación. */
  rowsMissingRequiredFields: number;
}
