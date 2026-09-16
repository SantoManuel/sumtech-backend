export type ImportContractStatus = 'PENDING_INSTALL' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
export type ImportDocType = 'CEDULA' | 'RNC' | 'PASAPORTE';

/**
 * Quita todo lo que no sea letra o número, en mayúsculas — misma normalización
 * que usa normalizeDocNumber() en legacy-network-import/build-import-plan.ts,
 * a propósito: la Fase 04 (import de red) busca el cliente por este mismo
 * criterio, así que ambas importaciones deben coincidir en cómo comparan.
 */
export function normalizeDocNumber(docNumber: string): string {
  return (docNumber || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Infiere el tipo de documento a partir del formato. Nunca bloquea la fila:
 * si no reconoce el patrón, devuelve CEDULA con confident=false para que el
 * llamador pueda marcar la fila para revisión manual sin descartar al cliente.
 */
export function inferDocType(docNumber: string): { docType: ImportDocType; confident: boolean } {
  const normalized = normalizeDocNumber(docNumber);
  // Cédula dominicana: 11 dígitos (con o sin guiones en el original).
  if (/^\d{11}$/.test(normalized)) {
    return { docType: 'CEDULA', confident: true };
  }
  // RNC: 9 dígitos.
  if (/^\d{9}$/.test(normalized)) {
    return { docType: 'RNC', confident: true };
  }
  return { docType: 'CEDULA', confident: false };
}

const ESTADO_SYNONYMS: Record<string, ImportContractStatus> = {
  activo: 'ACTIVE',
  active: 'ACTIVE',
  suspendido: 'SUSPENDED',
  suspended: 'SUSPENDED',
  pendiente: 'PENDING_INSTALL',
  pending: 'PENDING_INSTALL',
  cortado: 'TERMINATED',
  desconectado: 'TERMINATED',
  cancelado: 'TERMINATED',
  terminado: 'TERMINATED',
  cut: 'TERMINATED',
};

/**
 * Mapea el "Estado" legacy (del servicio de internet) al status del
 * contrato. Un valor vacío o no reconocido nunca bloquea la fila — degrada a
 * PENDING_INSTALL con recognized=false para revisión manual posterior.
 */
export function mapEstadoToContractStatus(raw: string): { status: ImportContractStatus; recognized: boolean } {
  const key = (raw || '')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .trim();
  if (!key) return { status: 'PENDING_INSTALL', recognized: true };
  const mapped = ESTADO_SYNONYMS[key];
  return mapped ? { status: mapped, recognized: true } : { status: 'PENDING_INSTALL', recognized: false };
}

/**
 * Parsea "50.0 Mbps 1600.00" -> { speedMbps: 50, monthlyPrice: 1600 }.
 * Tolera separador de miles y símbolo de moneda en el precio ("RD$1,600.00").
 * Devuelve null si no se puede extraer una velocidad válida — el llamador
 * decide qué hacer (nunca se asume un plan por defecto).
 */
export function parsePlanInternet(raw: string): { speedMbps: number; monthlyPrice: number } | null {
  if (!raw) return null;
  const speedMatch = raw.match(/([\d.]+)\s*mbps/i);
  if (!speedMatch) return null;

  const speedMbps = parseFloat(speedMatch[1]);
  if (!Number.isFinite(speedMbps) || speedMbps <= 0) return null;

  const afterSpeed = raw.slice((speedMatch.index ?? 0) + speedMatch[0].length);
  const priceMatch = afterSpeed.match(/([\d,]+\.?\d*)/);
  const monthlyPrice = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;
  if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) return null;

  return { speedMbps, monthlyPrice };
}

/** Parsea "20/01/2024 12:55" (o solo la fecha) -> "2024-01-20". Null si no calza el patrón. */
export function parseInstallDate(raw: string): string | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parsea "18.4861,-69.9312" -> { lat, lng }. Null si falta, está vacío o fuera de rango. */
export function parseGpsCoordinates(raw: string): { lat: number; lng: number } | null {
  if (!raw || !raw.includes(',')) return null;
  const [latRaw, lngRaw] = raw.split(',').map((v) => v.trim());
  const lat = parseFloat(latRaw);
  const lng = parseFloat(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Parsea "200,00" / "1,600.00" / "" -> número. Nunca lanza; vacío o inválido = 0. */
export function parseSaldo(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  // Formato "200,00" (coma decimal, típico de exports en español) vs "1,600.00"
  // (coma de miles): si hay coma Y punto, la coma es separador de miles; si
  // solo hay coma, es el separador decimal.
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }
  const value = parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Clave estable para agrupar filas por ubicación legacy (Barrio + Ciudad/Municipio). */
export function buildLocationKey(barrio: string, ciudadMunicipio: string): string {
  return `${(barrio || '').trim().toUpperCase()}||${(ciudadMunicipio || '').trim().toUpperCase()}`;
}
