import { Logger } from '@nestjs/common';
import { isIP } from 'net';
import { AuthorizeOnuParams } from '../ports/olt-driver.port';
import { Tr069Result, initialTr069Result, evidence } from '../ports/tr069-provisioning.types';
import { ZteSessionLike } from './zte-telnet-session';
import {
  isOltErrorResponse,
  isAlreadyAppliedResponse,
  parseIpHost,
  parseOnuDetailInfo,
} from './zte-c320-parsers';
import {
  generateTr069ManagementScript,
  generateTr069TransportScript,
  toOnuInterfaceName,
  isPreparatoryTeardownCommand,
  isTr069TransportAlreadyApplied,
  isTr069ManagementAlreadyApplied,
  SWITCHPORT_BIND_RE,
} from './zte-c320-provisioning-scripts';
import { validateTr069Input } from './zte-c320-tr069-state';

/**
 * Etapa 2 del flujo de 3 etapas (apuntar la ONU al ACS/TR-069) en ZTE C320.
 *
 * Directriz de arquitectura OLT:
 * - NO ejecutar "show running-config" sobre el chasis: en ZTE C320 vuelca decenas
 *   de miles de líneas, bloquea el plano de control (CLI) y genera timeouts.
 * - La aplicación se realiza mediante secuencias de comandos CLI directas y
 *   dosificadas (pacing), verificando el estado de convergencia de forma puntual
 *   y liviana vía "show gpon onu detail-info" e IP-Host.
 */

type DelayFn = (ms: number) => Promise<void>;
const defaultDelay: DelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pausa deliberada entre comandos para hardware ZTE C320. Previene
 * colisiones de buffers de entrada y permite que la MIB OMCI sincronice
 * adecuadamente -- BUG REAL CONFIRMADO EN VIVO (2026-10-30, ONU
 * CMDCDD4D131E, ver test "aplica pacing humano..." en
 * zte-c320.driver.spec.ts): sin NINGÚN pacing, "write" quedaba seguido de
 * inmediato por el siguiente "configure terminal" y la OLT lo rechazaba con
 * "%Error 20200". Por eso esta pausa no se elimina, solo se recorta.
 *
 * Valores recortados (2026-11-06, decisión explícita del usuario con el
 * requisito duro de que "Aplicar Perfil TR-069" tarde como máximo 10s
 * incluso en el peor caso -- ONU nueva, nada aplicado todavía, ~30
 * comandos reales): calculados para que el pacing puro del peor caso
 * completo (transporte + pausa de asentamiento + bloque OMCI + 1
 * verificación corta) sume ~5s, dejando ~5s de margen para la latencia
 * real de ida y vuelta de esos ~32 comandos por Telnet (desconocida sin
 * medirla en vivo). Es un primer recorte conservador, no el valor final --
 * PENDIENTE de validar en vivo contra OLT_Tabara_Abajo (Fase 5 de
 * Plan_Implementacion_Tr069_Aplicar_Perfil_Idempotente.md): si en el
 * equipo real reaparece el glitch "%Error 20200" con más frecuencia que
 * antes, hay que subir estos números (y renegociar el límite de 10s si
 * hiciera falta), no bajarlos más a ciegas.
 */
export function getTr069PacingDelay(cmd: string): number {
  if (cmd === 'write') {
    return 250;
  }
  if (cmd.startsWith('pon-onu-mng ') || cmd.startsWith('interface gpon-onu_')) {
    return 150;
  }
  if (cmd === 'exit' || cmd === 'end') {
    return 80;
  }
  if (cmd === 'configure terminal') {
    return 80;
  }
  return 100;
}

/**
 * Prepara la capa de TRANSPORTE del canal de gestión/TR-069 (tcont 2/
 * gemport 2/traffic-limit/service-port 2). Etapa 2 es autosuficiente y
 * no asume que Etapa 1 haya creado esta capa.
 */
export async function ensureTr069TransportWithSession(
  session: ZteSessionLike,
  config: AuthorizeOnuParams,
  delay: DelayFn = defaultDelay,
): Promise<void> {
  if (!config.tr069Vlan) {
    throw new Error('No se puede preparar el canal de gestión/TR-069: falta la VLAN de TR-069 (tr069Vlan).');
  }

  const commands = generateTr069TransportScript(config);

  const runPaced = async (cmd: string): Promise<string> => {
    let output = await session.executeCommand(cmd);
    if (output.includes('%Error 20200')) {
      await delay(350);
      output = await session.executeCommand(cmd);
    }
    const pacingMs = getTr069PacingDelay(cmd);
    if (pacingMs > 0) {
      await delay(pacingMs);
    }
    return output;
  };

  for (const cmd of commands) {
    if (cmd === 'configure terminal') {
      await runPaced(cmd);
      // Configuración de DHCP Snooping en la OLT para la VLAN de gestión TR-069 (best-effort)
      try {
        await session.executeCommand('ip dhcp snooping enable');
        await session.executeCommand(`ip dhcp snooping vlan ${config.tr069Vlan}`);
        await session.executeCommand('ip dhcp snooping control-port disable');
      } catch {
        /* best-effort */
      }
      continue;
    }

    if (cmd.startsWith('no service-port') || isPreparatoryTeardownCommand(cmd)) {
      await runPaced(cmd);
      continue;
    }

    const output = await runPaced(cmd);
    if (isOltErrorResponse(output) && !isAlreadyAppliedResponse(output)) {
      try {
        await session.executeCommand('exit');
      } catch {
        /* best-effort */
      }
      throw new Error(`La OLT rechazó "${cmd}": ${output.trim()}`);
    }
  }
}

/**
 * Aplica el bloque OMCI y transporte que apunta la ONU al ACS (TR-069) -- Etapa 2.
 * Ejecuta comandos directamente sin invocar `show running-config` para evitar bloqueos del CLI.
 */
export async function applyTr069ManagementWithSession(
  session: ZteSessionLike,
  config: AuthorizeOnuParams,
  logger: Logger,
  delay: DelayFn = defaultDelay,
): Promise<Tr069Result> {
  const started = Date.now();
  const result = initialTr069Result();
  result.stage = 'preflight';

  try {
    validateTr069Input(config, false);
    const onuInterface = toOnuInterfaceName(config.ponInterface, config.onuId);

    result.stage = 'transport';
    await config.onTr069Stage?.(result.stage);
    // Lectura acotada y segura (confirmada en vivo, 2026-11-06) para no
    // repetir ciegamente un bloque que ya está aplicado -- a diferencia de
    // "show running-config" (chasis completo), "show running-config
    // interface <iface>" está acotado a esta sola interfaz.
    const transportRaw = await session.executeCommand(`show running-config interface ${onuInterface}`, 15000).catch(() => undefined);
    const transportAlreadyApplied = isTr069TransportAlreadyApplied(transportRaw, config);
    if (transportAlreadyApplied) {
      logger.log(`[diag] applyTr069Management: capa de transporte ya coincide con el objetivo -- se omite (ONU ${onuInterface}).`);
    } else {
      await ensureTr069TransportWithSession(session, config, delay);
    }

    // Lectura acotada y segura del bloque OMCI "pon-onu-mng" (confirmada en
    // vivo, 2026-11-06 vía "show onu running config <iface>") -- evita
    // reenviar flow/switchport-bind/ip-host/tr069-mgmt ya correctos, que es
    // justo lo que tumbaba momentáneamente un canal de gestión ya activo.
    const managementRaw = await session.executeCommand(`show onu running config ${onuInterface}`, 10000).catch(() => undefined);
    const managementAlreadyApplied = isTr069ManagementAlreadyApplied(managementRaw, config);
    const nothingToChange = transportAlreadyApplied && managementAlreadyApplied;

    if (!nothingToChange && !transportAlreadyApplied) {
      // Pausa de asentamiento de la capa de transporte antes del bloque
      // OMCI -- solo hace falta si la capa de transporte se tocó de verdad
      // en esta misma ejecución. Recortada de 6000ms a 120ms (2026-11-06,
      // requisito duro de <=10s totales; valor distinto al pacing genérico
      // de "interface"/"pon-onu-mng" a propósito, para no confundir ambas
      // pausas al medir) -- ver nota de presupuesto en getTr069PacingDelay().
      await delay(120);
    }

    const warnings: string[] = [];
    const inTr069Block = true;

    if (managementAlreadyApplied) {
      logger.log(`[diag] applyTr069Management: bloque de gestión OMCI ya coincide con el objetivo -- se omite (ONU ${onuInterface}).`);
    } else {
      result.stage = 'configuration';
      await config.onTr069Stage?.(result.stage);
      const commands = generateTr069ManagementScript(config);

      for (const cmd of commands) {
        if (isPreparatoryTeardownCommand(cmd)) {
          await session.executeCommand(cmd);
          const pacingMs = getTr069PacingDelay(cmd);
          if (pacingMs > 0) {
            await delay(pacingMs);
          }
          continue;
        }

        let output = await session.executeCommand(cmd);
        if (output.includes('%Error 20200')) {
          logger.warn(`[human-sim] applyTr069Management: reintentando comando "${cmd}" tras detectar glitch de input %Error 20200`);
          await delay(350);
          output = await session.executeCommand(cmd);
        }

        const pacingMs = getTr069PacingDelay(cmd);
        if (pacingMs > 0) {
          await delay(pacingMs);
        }

        if (isOltErrorResponse(output)) {
          if (isAlreadyAppliedResponse(output) && SWITCHPORT_BIND_RE.test(cmd)) {
            logger.warn(`[diag] applyTr069Management: "${cmd}" ya existía -- forzando re-enlace limpio por si quedó de un intento anterior`);
            try {
              await session.executeCommand(cmd.replace(/^switchport-bind/, 'no switchport-bind'));
              await delay(getTr069PacingDelay(cmd));
            } catch {
              /* best-effort */
            }
            const retryOutput = await session.executeCommand(cmd);
            if (isOltErrorResponse(retryOutput) && !isAlreadyAppliedResponse(retryOutput)) {
              const msg =
                `La OLT rechazó re-enlazar la configuración TR-069/ACS ("${cmd}"): ${retryOutput.trim()}. ` +
                'Probablemente debas configurar el WAN manualmente en la ONU.';
              warnings.push(msg);
              logger.warn(`[diag] applyTr069Management: ${msg}`);
            }
          } else if (isAlreadyAppliedResponse(output)) {
            // Ya aplicado previamente, continuar.
          } else if (inTr069Block) {
            const msg =
              `La OLT rechazó la configuración TR-069/ACS ("${cmd}"): ${output.trim()}. ` +
              'Probablemente debas configurar el WAN manualmente en la ONU.';
            warnings.push(msg);
            logger.warn(`[diag] applyTr069Management: TR-069/ACS best-effort falló, continuando: ${msg}`);
          } else {
            throw new Error(`La OLT rechazó el comando "${cmd}": ${output.trim()}`);
          }
        }
      }
    }

    result.stage = 'verification';
    await config.onTr069Stage?.(result.stage);
    let lastConfigState: string | undefined;
    let lastReadError: string | undefined;

    // Si no hubo nada que cambiar, una sola lectura inmediata basta -- no
    // hay ninguna convergencia nueva que esperar. Si sí se mandaron
    // comandos, se conservan 3 reintentos cortos (recortados de hasta 45s
    // en 4 intentos de 5s/10s/15s/15s a 3s totales en 3 intentos de
    // 0.5s/1s/1.5s -- 2026-11-06, requisito duro de <=10s totales) para no
    // perder la resiliencia real que ya probaba este polling: tolerar una
    // lectura fallida puntual (timeout de Telnet) y darle a la OMCI del
    // ONT un par de intentos más antes de reportarlo como advertencia (no
    // como fallo) -- el técnico igual puede reconfirmar con un segundo
    // "Aplicar Perfil", que ahora responde en segundos gracias al camino
    // rápido de arriba.
    const CONFIG_STATE_POLL_DELAYS_MS = nothingToChange ? [0] : [500, 1000, 1500];
    for (const pollDelayMs of CONFIG_STATE_POLL_DELAYS_MS) {
      if (pollDelayMs > 0) {
        await delay(pollDelayMs);
      }
      try {
        const detailOutput = await session.executeCommand(`show gpon onu detail-info ${onuInterface}`);
        const parsedDetail = parseOnuDetailInfo(detailOutput);
        lastConfigState = parsedDetail.configState;
        lastReadError = undefined;
        if (lastConfigState && lastConfigState.toLowerCase() === 'success') {
          break;
        }
      } catch (err: any) {
        lastReadError = err.message;
        logger.warn(`[diag] applyTr069Management: no se pudo verificar "Config state" en este intento: ${err.message}`);
      }
    }

    if (lastReadError && !lastConfigState) {
      logger.warn(`[diag] applyTr069Management: no se pudo verificar "Config state" tras el polling: ${lastReadError}`);
    } else if (lastConfigState && lastConfigState.toLowerCase() !== 'success') {
      const configStateWarning =
        `El "Config state" del ONT quedó en "${lastConfigState}" (no "success") tras aplicar el bloque TR-069. ` +
        'Nota: si la ONT se está reiniciando, este estado es transitorio mientras sincroniza MIB. ' +
        'Verifica en el MikroTik si la ONT ya obtuvo IP en la VLAN de gestión (' +
        (config.tr069Vlan ?? '444') +
        ').';
      warnings.push(configStateWarning);
      logger.warn(`[diag] applyTr069Management: ${configStateWarning}`);
    }

    try {
      const hostOutput = await session.executeCommand(`show gpon remote-onu ip-host ${onuInterface}`);
      const host = parseIpHost(hostOutput);
      const validIp = !!host.mgmtIp && isIP(host.mgmtIp) === 4 && !/^(0\.|127\.|169\.254\.|255\.)/.test(host.mgmtIp);
      result.evidence.ip = evidence(validIp ? 'confirmed' : host.ipHostFound ? 'failed' : 'unknown', 'ip-host', validIp ? 'IP de gestión: ' + host.mgmtIp : 'IP de gestión no confirmada.');
    } catch {
      /* best-effort */
    }

    result.ok = true;
    result.status = 'applied_unverified';
    result.configurationStatus = 'confirmed';
    result.persistenceStatus = 'confirmed';
    result.evidence.configuration = evidence('confirmed', 'cli');
    result.evidence.persistence = evidence('confirmed', 'write');
    result.evidence.omci = evidence(
      lastConfigState && lastConfigState.toLowerCase() === 'success' ? 'confirmed' : 'unknown',
      'detail-info',
      lastConfigState ? `Config state: ${lastConfigState}` : undefined,
    );
    if (warnings.length > 0) {
      result.warning = warnings.join(' | ');
    }
  } catch (err: any) {
    result.ok = false;
    result.status = 'failed';
    result.error = err.message;
    result.configurationStatus = 'failed';
    result.evidence.configuration = evidence('failed', result.stage, err.message);
  } finally {
    result.durationMs = Date.now() - started;
  }

  return result;
}

/**
 * Versión aislada que solo actualiza el ACS (TR-069) sin alterar la capa de transporte.
 * Ejecuta comandos directamente sin volcar `show running-config`.
 */
export async function updateTr069AcsUrlWithSession(
  session: ZteSessionLike,
  config: {
    ponInterface: string;
    onuId: number;
    tr069Url: string;
    serialNumber?: string;
    tr069AcsUsername?: string;
    tr069AcsPassword?: string;
  },
  logger: Logger = new Logger('Tr069'),
  delay: DelayFn = defaultDelay,
): Promise<Tr069Result> {
  const started = Date.now();
  const result = initialTr069Result();
  result.stage = 'configuration';

  try {
    const onuInterface = toOnuInterfaceName(config.ponInterface, config.onuId);

    await session.executeCommand('configure terminal');
    const pomOutput = await session.executeCommand(`pon-onu-mng ${onuInterface}`);
    if (isOltErrorResponse(pomOutput)) {
      throw new Error(`La OLT rechazó entrar a "pon-onu-mng ${onuInterface}": ${pomOutput.trim()}`);
    }

    const acsCmd =
      config.tr069AcsUsername && config.tr069AcsPassword
        ? `tr069-mgmt 1 acs ${config.tr069Url} validate basic username ${config.tr069AcsUsername} password ${config.tr069AcsPassword}`
        : `tr069-mgmt 1 acs ${config.tr069Url}`;
    const acsOutput = await session.executeCommand(acsCmd);
    if (isOltErrorResponse(acsOutput) && !isAlreadyAppliedResponse(acsOutput)) {
      throw new Error(`La OLT rechazó "tr069-mgmt 1 acs": ${acsOutput.trim()}`);
    }

    await session.executeCommand('end');
    await session.executeCommand('write');

    result.ok = true;
    result.status = 'applied_unverified';
    result.configurationStatus = 'confirmed';
    result.persistenceStatus = 'confirmed';
    result.evidence.configuration = evidence('confirmed', 'cli');
    result.evidence.persistence = evidence('confirmed', 'write');
  } catch (err: any) {
    result.ok = false;
    result.status = 'failed';
    result.error = err.message;
    result.configurationStatus = 'failed';
    result.evidence.configuration = evidence('failed', result.stage, err.message);
  } finally {
    result.durationMs = Date.now() - started;
  }

  return result;
}
