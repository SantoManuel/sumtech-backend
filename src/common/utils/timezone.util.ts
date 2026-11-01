/**
 * Fecha/hora "de calendario" por tenant, usando `company_profile.timezone`
 * (columna que ya existía pero nunca se leía — ver DashboardService).
 * Sin dependencias nuevas: usa Intl, que trae ICU completo en Node 20.
 */

export const DEFAULT_TENANT_TIMEZONE = 'America/Santo_Domingo';

function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);

  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUTC - date.getTime();
}

/** Instante UTC correspondiente a la medianoche de `date`, en `timeZone`. */
export function startOfDayInTimezone(date: Date, timeZone: string): Date {
  const offsetMs = getTimezoneOffsetMs(date, timeZone);
  const localAsUtc = new Date(date.getTime() + offsetMs);
  localAsUtc.setUTCHours(0, 0, 0, 0);
  return new Date(localAsUtc.getTime() - offsetMs);
}

/** Clave "YYYY-MM-DD" del día de calendario que `date` representa en `timeZone`. */
export function dateKeyInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}
