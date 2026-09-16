import { computeOnlineStatus, isOpticalPowerCritical, ONU_ONLINE_THRESHOLD_MS } from './genieacs-online-status.util';

describe('computeOnlineStatus', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');

  it('devuelve UNKNOWN si nunca hubo un Inform (null)', () => {
    expect(computeOnlineStatus(null, now)).toBe('UNKNOWN');
  });

  it('devuelve UNKNOWN si nunca hubo un Inform (undefined)', () => {
    expect(computeOnlineStatus(undefined, now)).toBe('UNKNOWN');
  });

  it('devuelve ONLINE si el último Inform fue hace 1 minuto', () => {
    const lastInformAt = new Date(now.getTime() - 60 * 1000);
    expect(computeOnlineStatus(lastInformAt, now)).toBe('ONLINE');
  });

  it('devuelve ONLINE justo en el límite del umbral (15 min exactos)', () => {
    const lastInformAt = new Date(now.getTime() - ONU_ONLINE_THRESHOLD_MS);
    expect(computeOnlineStatus(lastInformAt, now)).toBe('ONLINE');
  });

  it('devuelve OFFLINE apenas un milisegundo después del umbral', () => {
    const lastInformAt = new Date(now.getTime() - ONU_ONLINE_THRESHOLD_MS - 1);
    expect(computeOnlineStatus(lastInformAt, now)).toBe('OFFLINE');
  });

  it('devuelve OFFLINE si el último Inform fue hace varias horas', () => {
    const lastInformAt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    expect(computeOnlineStatus(lastInformAt, now)).toBe('OFFLINE');
  });

  it('devuelve ONLINE (no revienta) si el reloj del CPE está adelantado respecto al del servidor', () => {
    const lastInformAt = new Date(now.getTime() + 60 * 1000);
    expect(computeOnlineStatus(lastInformAt, now)).toBe('ONLINE');
  });
});

describe('isOpticalPowerCritical', () => {
  it('devuelve false si no hay dato de potencia óptica (undefined)', () => {
    expect(isOpticalPowerCritical(undefined)).toBe(false);
  });

  it('devuelve false si no hay dato de potencia óptica (null)', () => {
    expect(isOpticalPowerCritical(null)).toBe(false);
  });

  it('devuelve false con una potencia óptica saludable', () => {
    expect(isOpticalPowerCritical(-18.5)).toBe(false);
  });

  it('devuelve false justo en el límite del umbral (-27 exacto)', () => {
    expect(isOpticalPowerCritical(-27)).toBe(false);
  });

  it('devuelve true apenas por debajo del umbral', () => {
    expect(isOpticalPowerCritical(-27.1)).toBe(true);
  });

  it('devuelve true con una potencia muy degradada', () => {
    expect(isOpticalPowerCritical(-35)).toBe(true);
  });
});
