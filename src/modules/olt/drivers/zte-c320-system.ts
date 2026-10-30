import { OltSystemInfo, OltSystemHealth, DiscoveredCard } from '../ports/olt-driver.port';
import { ZteSessionLike } from './zte-telnet-session';
import { parseCards, parseZteUptimeToSeconds } from './zte-c320-parsers';

/**
 * Información general de sistema/salud/chasis del ZTE C320 -- extraída de
 * `zte-c320.driver.ts` (Fase 7 de Plan_Implementacion_Refactor_ZteC320Driver.md).
 * Cada función recibe una sesión YA conectada; el ciclo de vida
 * create/connect/close se queda en los métodos delgados de `ZteC320Driver`.
 */

/**
 * Obtiene información general del sistema y firmware (show system-group, show version).
 */
export async function getSystemInfoWithSession(session: ZteSessionLike): Promise<OltSystemInfo> {
  const rawSystem = await session.executeCommand('show system-group');
  const rawVersion = await session.executeCommand('show version-running');

  const uptimeMatch = rawSystem.match(/Started before:\s*(.+)/i);
  const uptime = uptimeMatch ? uptimeMatch[1].trim() : '—';

  const versionMatch = rawVersion.match(/V[\d.]+\S*/i) || rawSystem.match(/Software Version:\s*(\S+)/i);
  const firmwareVersion = versionMatch ? versionMatch[0] : 'V1.2.5P3';

  return {
    vendor: 'ZTE',
    model: 'C320',
    uptime,
    firmwareVersion,
    rawSystemGroup: rawSystem.slice(0, 500),
  };
}

/**
 * CPU/memoria/temperatura del chasis (RF-OLT-005). Comandos confirmados
 * contra una OLT C320 real en producción (OLT_Tabara_Abajo, 2026-10-17) y
 * respaldados por el manual oficial "ZXA10 C300 Configuration Manual (CLI)"
 * §1.3.5 "Showing Cards" (`show card slotno <N>` expone Cpu-Usage/Mem-Usage/
 * Uptime por tarjeta) y §1.3.9 "Configuring Fans" (`show fan` expone
 * "Environment Temperature"). No existe un único slot "de control" fijo por
 * nombre de tipo -- varía por chasis (SCXN en el manual, SMXA en este
 * equipo real) -- así que se recorren las tarjetas EN SERVICIO devueltas
 * por `show card` y se usa la primera cuyo detalle traiga Cpu-Usage real
 * (las tarjetas sin CPU propio, ej. PRAM, devuelven esos campos vacíos).
 */
export async function getSystemHealthWithSession(session: ZteSessionLike): Promise<OltSystemHealth> {
  const cardListOutput = await session.executeCommand('show card');
  const cards = parseCards(cardListOutput);

  let cpuUsagePercent: number | undefined;
  let memoryUsagePercent: number | undefined;
  let uptimeSeconds: number | undefined;
  let rawDetail = '';

  for (const card of cards) {
    if (card.status !== 'INSERVICE') continue;
    const detail = await session.executeCommand(`show card slotno ${card.slot}`);
    const cpuMatch = detail.match(/Cpu-Usage\s*:\s*(\d+)%/i);
    const memMatch = detail.match(/Mem-Usage\s*:\s*(\d+)%/i);
    if (!cpuMatch || !memMatch) continue;

    cpuUsagePercent = parseInt(cpuMatch[1], 10);
    memoryUsagePercent = parseInt(memMatch[1], 10);
    const uptimeMatch = detail.match(/Uptime\s*:\s*([^\r\n]+)/i);
    uptimeSeconds = uptimeMatch ? parseZteUptimeToSeconds(uptimeMatch[1].trim()) : undefined;
    rawDetail = detail.slice(0, 500);
    break;
  }

  const fanOutput = await session.executeCommand('show fan');
  const tempMatch = fanOutput.match(/Environment Temperature\s*:?\s*(-?\d+)/i);
  const temperatureCelsius = tempMatch ? parseInt(tempMatch[1], 10) : undefined;

  return {
    cpuUsagePercent,
    memoryUsagePercent,
    temperatureCelsius,
    uptimeSeconds,
    raw: rawDetail || fanOutput.slice(0, 500),
  };
}

/**
 * Inventario real de tarjetas/slots del chasis (show card). Usa el mismo
 * comando ya verificado en test/fixtures/zte-c320/show_card.txt.
 */
export async function getCardsWithSession(session: ZteSessionLike): Promise<DiscoveredCard[]> {
  const output = await session.executeCommand('show card');
  return parseCards(output);
}
