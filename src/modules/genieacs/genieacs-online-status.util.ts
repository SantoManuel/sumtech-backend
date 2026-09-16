/**
 * `bootstrap.js` del servidor GenieACS fija el Inform periódico en 300s (5 min,
 * ver sumtech_servidor_genieacs/config/provisions/bootstrap.js). Se considera
 * ONLINE si el último Inform llegó dentro de un margen de 3x ese intervalo
 * (15 min) — generoso a propósito: un CPE sano puede demorar un ciclo extra
 * por congestión de red sin que eso signifique que está caído.
 */
export const ONU_ONLINE_THRESHOLD_MS = 15 * 60 * 1000;

/** Mismo umbral que ya usa periodic_inform.js del lado de GenieACS para marcar Tags.ALERT_LOW_OPTICAL_POWER. */
export const ONU_OPTICAL_ALERT_THRESHOLD_DBM = -27;

export type OnuOnlineStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

/**
 * Deriva el estado online/offline de la ONU a partir de la última vez que
 * hizo Inform — nunca se confía en un campo "online" que alguien tenga que
 * poner en false manualmente (no existe tal mecanismo confiable del lado de
 * GenieACS), se calcula siempre en base a la frescura del dato.
 */
export function computeOnlineStatus(lastInformAt: Date | undefined | null, now: Date = new Date()): OnuOnlineStatus {
  if (!lastInformAt) {
    return 'UNKNOWN';
  }
  const elapsedMs = now.getTime() - lastInformAt.getTime();
  if (elapsedMs < 0) {
    // Reloj del CPE adelantado respecto al del servidor — no es señal de OFFLINE.
    return 'ONLINE';
  }
  return elapsedMs <= ONU_ONLINE_THRESHOLD_MS ? 'ONLINE' : 'OFFLINE';
}

export function isOpticalPowerCritical(opticalRxPowerDbm: number | undefined | null): boolean {
  return typeof opticalRxPowerDbm === 'number' && opticalRxPowerDbm < ONU_OPTICAL_ALERT_THRESHOLD_DBM;
}
