/**
 * Formateo de fecha/hora para documentos DGII (e-CF) y representaciones impresas.
 *
 * Usa un `timeZone` IANA explícito vía Intl.DateTimeFormat en vez de los getters
 * locales de Date (getDate/getMonth/getHours/...), que dependen del reloj del
 * proceso donde corre Node y no de la hora real de República Dominicana.
 */

const DGII_TIME_ZONE = 'America/Santo_Domingo';

function getDateParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const result: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      result[part.type] = part.value;
    }
  }
  // Intl puede devolver "24" para medianoche cuando hour12 es false; normalizar a "00".
  if (result.hour === '24') {
    result.hour = '00';
  }
  return result;
}

/** Formatea una fecha al formato requerido por la DGII (dd-MM-yyyy), en hora de RD. */
export function formatDateDgii(date: Date = new Date(), timeZone: string = DGII_TIME_ZONE): string {
  const p = getDateParts(date, timeZone);
  return `${p.day}-${p.month}-${p.year}`;
}

/** Formatea fecha y hora para nodos como FechaHoraFirma (dd-MM-yyyy HH:mm:ss), en hora de RD. */
export function formatDateTimeDgii(date: Date = new Date(), timeZone: string = DGII_TIME_ZONE): string {
  const p = getDateParts(date, timeZone);
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
}
