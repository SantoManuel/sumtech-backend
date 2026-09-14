/**
 * Nombre determinístico del perfil PPP que Sumtech crea/mantiene en cada
 * nodo para una velocidad dada. Dos planes con el mismo speedMbps comparten
 * el mismo perfil — menos objetos que administrar en el router, no más.
 * Los planes de Sumtech son simétricos (mismo Mbps de subida y bajada, ver
 * "Fibra Simétrica" en el perfil del cliente), así que un solo número basta
 * para construir el rate-limit "rx/tx" que RouterOS espera.
 */
export function buildRouterProfileName(speedMbps: number): string {
  return `Sumtech-${speedMbps}Mbps`;
}

export function buildSymmetricRateLimit(speedMbps: number): string {
  return `${speedMbps}M/${speedMbps}M`;
}
