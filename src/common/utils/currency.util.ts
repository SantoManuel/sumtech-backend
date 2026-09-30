/**
 * Espejo de `CURRENCY_SYMBOLS` en `sumtech-frontend/src/lib/utils.ts` — el
 * backend no tenía ningún mapa de símbolos de moneda reutilizable hasta ahora
 * (cada listener que necesitaba mostrar dinero hardcodeaba "RD$"). Mantener
 * ambas copias en sync si se agrega una moneda nueva.
 */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  DOP: 'RD$',
  USD: '$',
  EUR: '€',
  CAD: 'CA$',
  GBP: '£',
  MXN: 'Mex$',
  COP: 'COL$',
  GTQ: 'Q',
  PEN: 'S/',
  BRL: 'R$',
  CLP: 'CLP$',
};

export function getCurrencySymbolForCurrency(currencyCode?: string | null): string {
  const code = (currencyCode || 'DOP').trim().toUpperCase();
  return CURRENCY_SYMBOLS[code] || code;
}
