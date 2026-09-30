import { InvoiceEntity } from './entities/invoice.entity';

export type InvoiceStatus = InvoiceEntity['status'];

/**
 * Estados de una factura que todavía no ha sido cobrada/timbrada (sin NCF) —
 * PENDING_PAYMENT, EN_GRACIA y VENCIDA son solo distintas etapas de la misma
 * situación de "aún debe pagarse", nunca estados terminales. Cualquier lugar
 * del código que hoy decida "¿se puede cobrar/anular esta factura?" debe
 * tratar los 3 por igual — si se compara solo contra 'PENDING_PAYMENT', una
 * factura EN_GRACIA/VENCIDA se vuelve incobrable en cuanto envejece, lo cual
 * es exactamente lo opuesto de lo que debe pasar.
 */
export const OPEN_INVOICE_STATUSES: readonly InvoiceStatus[] = ['PENDING_PAYMENT', 'EN_GRACIA', 'VENCIDA'];

export function isOpenInvoiceStatus(status: InvoiceStatus): boolean {
  return (OPEN_INVOICE_STATUSES as readonly string[]).includes(status);
}
