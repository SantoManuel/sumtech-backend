export interface DistinctLocationSummary {
  legacyLocationKey: string;
  barrio: string;
  ciudadMunicipio: string;
  occurrences: number;
  /** true si ya quedó resuelta (auto-match contra el catálogo, o reintento tras un análisis previo). */
  resolved: boolean;
  /** Presente solo si resolved=true por auto-match — para mostrarle al admin qué se asignó sin pedirle nada. */
  autoMatch?: {
    provinceName: string;
    municipalityName: string;
    sectorName: string;
    /** true si el sector no existía y se creará al confirmar la importación. */
    sectorIsNew: boolean;
  };
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
