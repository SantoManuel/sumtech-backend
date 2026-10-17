/**
 * Serializa operaciones Telnet contra una misma OLT física. Bug real
 * confirmado en producción (2026-10-17, OLT_Tabara_Abajo): dos cron jobs
 * (`handleScheduledMetricsPolling` y `handleScheduledOnuDiscovery`, ambos
 * '0 *\/15 * * * *') abren sesiones Telnet independientes contra la MISMA
 * OLT en el mismo tick, y una acción manual del operador (ej. "Importar
 * Autorizadas") que caiga en esa ventana compite por el mismo puerto Telnet
 * del equipo -- el resultado observado no fue lentitud sino un cuelgue
 * completo hasta agotar el timeout, incluso con 180s de margen. Verificado
 * en vivo que el comando real tarda 1-2s en una conexión aislada sin
 * contención -- el problema es la concurrencia, no el comando ni la OLT.
 *
 * Mutex en memoria, por proceso -- suficiente para el despliegue actual
 * (una sola instancia del backend). Si en el futuro se escala a múltiples
 * instancias, esto necesitaría un lock distribuido (ej. Redis).
 */

const queues = new Map<string, Promise<unknown>>();

export function withOltTelnetLock<T>(oltId: string, fn: () => Promise<T>): Promise<T> {
  const prior = queues.get(oltId) || Promise.resolve();
  const run = prior.then(fn, fn);
  queues.set(oltId, run.catch(() => undefined));
  return run;
}
