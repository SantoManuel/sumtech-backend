/**
 * Misma política de orígenes permitidos que `app.enableCors()` en main.ts --
 * extraída aquí para que el Gateway de WebSockets (RouterConsoleGateway) la
 * reutilice exactamente, en vez de duplicar (y potencialmente desincronizar)
 * la lista de dominios multi-tenant permitidos.
 */
export function isAllowedCorsOrigin(requestOrigin: string | undefined, configuredOrigins: string[]): boolean {
  // Permitir conexiones sin origen (curl, server-to-server, apps nativas)
  if (!requestOrigin) {
    return true;
  }

  if (configuredOrigins.includes(requestOrigin)) {
    return true;
  }

  const isLocalhostSubdomain = /^https?:\/\/([a-z0-9-]+\.)*localhost:(3000|3001)$/i.test(requestOrigin);
  if (isLocalhostSubdomain) {
    return true;
  }

  const isSumtechDomain = /^https:\/\/([a-z0-9-]+\.)*sumtech\.com$/i.test(requestOrigin);
  if (isSumtechDomain) {
    return true;
  }

  const isSumtechComDoDomain = /^https:\/\/([a-z0-9-]+\.)*sumtech\.com\.do$/i.test(requestOrigin);
  if (isSumtechComDoDomain) {
    return true;
  }

  const isSslipDomain = /^https?:\/\/([a-z0-9-]+\.)+[0-9.]+\.sslip\.io(:\d+)?$/i.test(requestOrigin);
  if (isSslipDomain) {
    return true;
  }

  return false;
}

export function getConfiguredCorsOrigins(): string[] {
  return (process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3001']).map((o) =>
    o.trim(),
  );
}
