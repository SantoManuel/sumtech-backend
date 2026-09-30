import {
  addDays,
  daysBetween,
  daysInMonth,
  resolveBillingDayForMonth,
  resolveProrationDayCount,
  toDateString,
} from './billing-date.util';

describe('billing-date.util', () => {
  describe('daysInMonth', () => {
    it('devuelve 30 para septiembre (mes 8, 0-indexado)', () => {
      expect(daysInMonth(2026, 8)).toBe(30);
    });

    it('devuelve 31 para octubre (mes 9, 0-indexado)', () => {
      expect(daysInMonth(2026, 9)).toBe(31);
    });

    it('devuelve 28 para febrero en un año no bisiesto (2026)', () => {
      expect(daysInMonth(2026, 1)).toBe(28);
    });

    it('devuelve 29 para febrero en un año bisiesto (2028)', () => {
      expect(daysInMonth(2028, 1)).toBe(29);
    });
  });

  describe('resolveBillingDayForMonth', () => {
    it('devuelve el mismo día si cabe en el mes', () => {
      expect(resolveBillingDayForMonth(2026, 8, 15)).toBe(15);
    });

    it('hace clamping al último día del mes si billingDay lo excede (31 en septiembre -> 30)', () => {
      expect(resolveBillingDayForMonth(2026, 8, 31)).toBe(30);
    });

    it('hace clamping en febrero no bisiesto (31 -> 28)', () => {
      expect(resolveBillingDayForMonth(2026, 1, 31)).toBe(28);
    });

    it('hace clamping en febrero bisiesto (31 -> 29)', () => {
      expect(resolveBillingDayForMonth(2028, 1, 31)).toBe(29);
    });
  });

  describe('toDateString', () => {
    it('formatea con padding de ceros', () => {
      expect(toDateString(2026, 0, 5)).toBe('2026-01-05');
    });

    it('formatea correctamente el mes 11 (diciembre)', () => {
      expect(toDateString(2026, 11, 25)).toBe('2026-12-25');
    });
  });

  describe('daysBetween', () => {
    it('es 0 para la misma fecha', () => {
      expect(daysBetween('2026-09-15', '2026-09-15')).toBe(0);
    });

    it('es positivo cuando dateStr es posterior a referenceStr', () => {
      expect(daysBetween('2026-09-20', '2026-09-15')).toBe(5);
    });

    it('es negativo cuando dateStr es anterior a referenceStr', () => {
      expect(daysBetween('2026-09-10', '2026-09-15')).toBe(-5);
    });

    it('cruza correctamente un límite de mes', () => {
      expect(daysBetween('2026-10-05', '2026-09-28')).toBe(7);
    });
  });

  describe('resolveProrationDayCount', () => {
    it('FIXED_30 siempre devuelve 30, sin importar el mes real', () => {
      expect(resolveProrationDayCount('FIXED_30', '2026-10-01', '2026-10-31')).toBe(30);
      expect(resolveProrationDayCount('FIXED_30', '2026-02-01', '2026-02-28')).toBe(30);
    });

    it('ACTUAL_MONTH_DAYS devuelve los días reales del período (31 en octubre)', () => {
      expect(resolveProrationDayCount('ACTUAL_MONTH_DAYS', '2026-10-01', '2026-10-31')).toBe(31);
    });

    it('ACTUAL_MONTH_DAYS devuelve 28 en febrero no bisiesto', () => {
      expect(resolveProrationDayCount('ACTUAL_MONTH_DAYS', '2026-02-01', '2026-02-28')).toBe(28);
    });

    it('ACTUAL_MONTH_DAYS devuelve 29 en febrero bisiesto', () => {
      expect(resolveProrationDayCount('ACTUAL_MONTH_DAYS', '2028-02-01', '2028-02-29')).toBe(29);
    });

    it('CYCLE_DAYS coincide con los días reales del período en este modelo (mes calendario = ciclo)', () => {
      expect(resolveProrationDayCount('CYCLE_DAYS', '2026-10-01', '2026-10-31')).toBe(31);
    });
  });

  describe('addDays', () => {
    it('suma días dentro del mismo mes', () => {
      expect(addDays('2026-09-15', 5)).toBe('2026-09-20');
    });

    it('cruza correctamente un límite de mes', () => {
      expect(addDays('2026-09-28', 5)).toBe('2026-10-03');
    });

    it('cruza correctamente un límite de año', () => {
      expect(addDays('2026-12-29', 5)).toBe('2027-01-03');
    });

    it('acepta días negativos (restar)', () => {
      expect(addDays('2026-09-15', -5)).toBe('2026-09-10');
    });

    it('maneja correctamente febrero bisiesto', () => {
      expect(addDays('2028-02-27', 3)).toBe('2028-03-01');
    });
  });
});
