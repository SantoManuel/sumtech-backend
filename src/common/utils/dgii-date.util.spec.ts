import { formatDateDgii, formatDateTimeDgii } from './dgii-date.util';

describe('dgii-date.util', () => {
  describe('formatDateDgii', () => {
    it('formatea en hora de Santo Domingo (UTC-4) aunque el reloj del proceso esté en UTC', () => {
      // 2026-10-19 23:30 America/Santo_Domingo == 2026-10-20 03:30 UTC
      const date = new Date('2026-10-20T03:30:00Z');
      expect(formatDateDgii(date)).toBe('19-10-2026');
    });

    it('no salta de día cuando la hora UTC equivalente cae en el día siguiente', () => {
      // 2026-03-05 20:15 America/Santo_Domingo == 2026-03-06 00:15 UTC
      const date = new Date('2026-03-06T00:15:00Z');
      expect(formatDateDgii(date)).toBe('05-03-2026');
    });
  });

  describe('formatDateTimeDgii', () => {
    it('resta las 4 horas de offset de República Dominicana', () => {
      // 14:30 America/Santo_Domingo == 18:30 UTC
      const date = new Date('2026-10-20T18:30:45Z');
      expect(formatDateTimeDgii(date)).toBe('20-10-2026 14:30:45');
    });

    it('acepta una zona horaria distinta explícita', () => {
      const date = new Date('2026-10-20T18:30:45Z');
      expect(formatDateTimeDgii(date, 'UTC')).toBe('20-10-2026 18:30:45');
    });
  });
});
