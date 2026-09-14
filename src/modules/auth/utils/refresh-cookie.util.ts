import { CookieOptions } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'sumtech_refresh_token';

const DEFAULT_REFRESH_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

/**
 * Convierte duraciones tipo '15m', '7d', '1h', '30s' (mismo formato que
 * JWT_REFRESH_EXPIRATION_TIME) a milisegundos, sin agregar la dependencia `ms`.
 * Si el formato no es reconocido, cae a 7 días (mismo default que el resto del
 * sistema usa para JWT_REFRESH_EXPIRATION_TIME).
 */
export function parseDurationToMs(duration: string | undefined): number {
  if (!duration) {
    return DEFAULT_REFRESH_DURATION_MS;
  }

  const match = /^(\d+)\s*(s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    return DEFAULT_REFRESH_DURATION_MS;
  }

  const value = Number(match[1]);
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return value * unitMs[match[2]];
}

/**
 * Opciones de la cookie httpOnly del refresh token.
 * `path` se acota a /<API_PREFIX>/auth para que la cookie solo viaje en las
 * rutas de login/refresh/logout, no en cada request de la API.
 * `secure` depende de NODE_ENV (no de https) porque el portal de clientes se
 * prueba también desde IPs de LAN sobre http:// — con `secure: true` fijo la
 * cookie se descartaría silenciosamente ahí.
 *
 * `maxAge` se omite del objeto (no se setea a un default) cuando no se pasa
 * explícitamente: `res.clearCookie()` en logout mergea estas opciones con su
 * propio `expires` en el pasado para forzar el borrado inmediato en el
 * navegador, y un `maxAge` de 7 días presente aquí pisaría ese `expires`,
 * dejando la cookie "viva" (vacía, pero no borrada) hasta su vencimiento natural.
 */
export function buildRefreshCookieOptions(maxAgeMs?: number): CookieOptions {
  const apiPrefix = process.env.API_PREFIX || 'api/v1';

  const options: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/${apiPrefix}/auth`,
  };

  if (maxAgeMs !== undefined) {
    options.maxAge = maxAgeMs;
  }

  return options;
}
