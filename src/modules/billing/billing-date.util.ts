export type ProrationDayCountPolicy = 'FIXED_30' | 'ACTUAL_MONTH_DAYS' | 'CYCLE_DAYS';

/** Cantidad de días en un mes calendario (0-indexado, igual que Date.getMonth()). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Día de corte efectivo de un contrato en un mes dado, con clamping para meses cortos (ej. día 31 en febrero -> 28). */
export function resolveBillingDayForMonth(year: number, month: number, billingDay: number): number {
  return Math.min(billingDay, daysInMonth(year, month));
}

/** Formatea una fecha (año/mes 0-indexado/día) como 'YYYY-MM-DD'. */
export function toDateString(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Diferencia en días (dateStr - referenceStr); negativa si dateStr ya pasó. Ambas en 'YYYY-MM-DD'. */
export function daysBetween(dateStr: string, referenceStr: string): number {
  const date = parseDateOnly(dateStr);
  const reference = parseDateOnly(referenceStr);
  return Math.round((date.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24));
}

export function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Suma (o resta, con un valor negativo) días a una fecha 'YYYY-MM-DD'. */
export function addDays(dateStr: string, days: number): string {
  const date = parseDateOnly(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Cantidad de días a usar como denominador del precio diario, según la política
 * configurada en BillingSettings — el sistema no asume permanentemente una única
 * fórmula de prorrateo (spec sección 9.2):
 * - FIXED_30: siempre 30, sin importar el mes real.
 * - ACTUAL_MONTH_DAYS / CYCLE_DAYS: días reales del período (en este modelo, el
 *   período de facturación es el mes calendario, así que ambas políticas
 *   coinciden hoy — se mantienen como valores distintos para que el sistema siga
 *   siendo correcto si el modelo de ciclo cambiara en el futuro).
 */
export function resolveProrationDayCount(
  policy: ProrationDayCountPolicy,
  periodStartStr: string,
  periodEndStr: string,
): number {
  if (policy === 'FIXED_30') {
    return 30;
  }
  // ACTUAL_MONTH_DAYS | CYCLE_DAYS
  return daysBetween(periodEndStr, periodStartStr) + 1;
}
