export type DiagnosticType = 'PING' | 'TRACEROUTE' | 'DOWNLOAD' | 'UPLOAD' | 'SITE_SURVEY';

export type DiagnosticStatus = 'NOT_SUPPORTED' | 'NOT_STARTED' | 'RUNNING' | 'COMPLETE' | 'ERROR';

export interface DiagnosticRouteHop {
  host?: string;
  hostAddress?: string;
}

export interface DiagnosticWifiNeighbor {
  ssid?: string;
  channel?: number;
  signalStrength?: number;
  bssid?: string;
}

/**
 * Resultado de un diagnóstico TR-143 (§3.15/§3.10 del plan). `result` trae
 * los campos numéricos/texto propios de cada tipo (ver
 * `genieacs-diagnostics.service.ts`); `routeHops`/`neighbors` solo se llenan
 * para TRACEROUTE/SITE_SURVEY respectivamente, porque esos dos devuelven una
 * tabla además de campos sueltos.
 */
export interface DiagnosticStatusResult {
  status: DiagnosticStatus;
  errorMessage?: string;
  result?: Record<string, string | number | undefined>;
  routeHops?: DiagnosticRouteHop[];
  neighbors?: DiagnosticWifiNeighbor[];
}

/** Parámetros de disparo -- cuáles aplican depende del `DiagnosticType`, ver TriggerDiagnosticDto. */
export interface TriggerDiagnosticInput {
  host?: string;
  numberOfRepetitions?: number;
  downloadUrl?: string;
  uploadUrl?: string;
  testFileLength?: number;
}
