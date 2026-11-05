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
 * Pausa deliberada entre comandos para hardware ZTE C320.
 * Previene colisiones de buffers de entrada y permite que la MIB OMCI
 * sincronice adecuadamente.
 */
export function getTr069PacingDelay(cmd: string): number {
  if (cmd === 'write') {
    return 8000;
  }
  if (cmd.startsWith('pon-onu-mng ') || cmd.startsWith('interface gpon-onu_')) {
    return 6000;
  }
  if (cmd === 'exit' || cmd === 'end') {
    return 1500;
  }
  if (cmd === 'configure terminal') {
    return 2000;
  }
  return 6000;
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

    result.stage = 'transport';
    await config.onTr069Stage?.(result.stage);
    await ensureTr069TransportWithSession(session, config, delay);

    // Pausa deliberada de 6s para asentar la capa de transporte antes del bloque OMCI
    await delay(6000);

    result.stage = 'configuration';
    await config.onTr069Stage?.(result.stage);
    const commands = generateTr069ManagementScript(config);
    const warnings: string[] = [];
    const inTr069Block = true;

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

    result.stage = 'verification';
    await config.onTr069Stage?.(result.stage);
    const onuInterface = toOnuInterfaceName(config.ponInterface, config.onuId);
    let lastConfigState: string | undefined;
    let lastReadError: string | undefined;

    // Polling acotado para convergencia OMCI mediante consulta liviana específica
    const CONFIG_STATE_POLL_DELAYS_MS = [5000, 10000, 15000, 15000];
    for (const pollDelayMs of CONFIG_STATE_POLL_DELAYS_MS) {
      await delay(pollDelayMs);
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
