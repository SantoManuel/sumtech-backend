/**
 * ARCHIVO: src/modules/invoicing/interfaces/dgii-response.interface.ts
 * RESPONSABILIDAD: Tipado de las respuestas emitidas por los servicios web de la DGII.
 * PROPIEDADES:
 * - trackId: string
 * - status: 'ACEPTADO' | 'RECHAZADO' | 'EN_PROCESO'
 * - securityCode: string
 * - qrUrl: string
 * - errors?: string[]
 * - timestamp: string
 */
export interface DgiiResponse {
  trackId: string;
  status: 'ACEPTADO' | 'RECHAZADO' | 'EN_PROCESO';
  securityCode: string;
  qrUrl: string;
  errors?: string[];
  timestamp: string;
}
