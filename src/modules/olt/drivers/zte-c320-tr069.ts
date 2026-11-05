import { Logger } from '@nestjs/common';
import { isIP } from 'net';
import { AuthorizeOnuParams } from '../ports/olt-driver.port';
import { Tr069Result, initialTr069Result, evidence } from '../ports/tr069-provisioning.types';
import { ZteSessionLike } from './zte-telnet-session';
import { parseIpHost, parseOnuDetailInfo, parseTcontProfilesFromOutput, parseTrafficProfilesFromOutput, parseVlanList } from './zte-c320-parsers';
import { toOnuInterfaceName } from './zte-c320-provisioning-scripts';
import { ZteCommandError, ZteCommandExecutor } from './zte-command-executor';
import { buildTr069Plan, parseTr069State, Tr069Step, validateTr069Input } from './zte-c320-tr069-state';

type DelayFn = (ms: number) => Promise<void>;
const defaultDelay: DelayFn = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Conservative CLI pacing; operational convergence is checked through reads. */
export function getTr069PacingDelay(cmd: string): number {
  return cmd === 'write' ? 1200 : /^(configure terminal|interface |pon-onu-mng |exit$|end$)/.test(cmd) ? 350 : 1200;
}

async function enter(executor: ZteCommandExecutor, iface: string, scope: 'interface' | 'onu'): Promise<void> {
  await executor.run('configure terminal', 'config');
  await executor.run(scope === 'interface' ? 'interface ' + iface : 'pon-onu-mng ' + iface, scope);
}

/** No reboot and no global policy changes. All mutations come from an observed diff. */
async function provision(
  session: ZteSessionLike, config: AuthorizeOnuParams, logger: Logger, delay: DelayFn, acsOnly: boolean,
): Promise<Tr069Result> {
  const started = Date.now();
  const result = initialTr069Result();
  const executor = new ZteCommandExecutor(session, delay, [config.tr069AcsUsername, config.tr069AcsPassword], 240000, config.tr069RemainingMs);
  const applied: Tr069Step[] = [];
  let scope: 'interface' | 'onu' | undefined;
  let iface = '';
  let plan: Tr069Step[] = [];
  try {
    validateTr069Input(config, acsOnly);
    iface = toOnuInterfaceName(config.ponInterface, config.onuId);
    const state = parseTr069State(await executor.run('show running-config'), iface, config.serialNumber);
    plan = buildTr069Plan(config, state, acsOnly);
    if (!acsOnly) {
      const profiles = parseTcontProfilesFromOutput(await executor.run('show gpon profile tcont'));
      if (!profiles.some(profile => profile.name === 'SMARTOLT-VOIPMNG-10M')) throw new Error('Falta el perfil TCONT SMARTOLT-VOIPMNG-10M; créalo en el mantenimiento de OLT.');
      // "gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M" (ver generateTr069TransportScript)
      // exige que este traffic-profile exista -- a diferencia del TCONT de arriba (ancho de banda
      // de SUBIDA), este gobierna la BAJADA del canal de gestión; sin preflight, su ausencia nunca
      // se detectaba porque el comando ni siquiera se mandaba (bug real confirmado 2026-11-04).
      const trafficProfiles = parseTrafficProfilesFromOutput(await executor.run('show traffic-profile'));
      if (!trafficProfiles.some(profile => profile.name === 'SMARTOLT-VOIPMNG-10M')) throw new Error('Falta el traffic-profile de bajada SMARTOLT-VOIPMNG-10M; créalo en el mantenimiento de OLT.');
      const vlanOutput = await executor.run('show vlan');
      const vlans = [...new Set(vlanOutput.split(/\r?\n/).flatMap(line => {
        const list = line.match(/^\s*vlan\s+([\d, -]+)\s*$/i)?.[1];
        const table = line.match(/^\s*(\d{1,4})\s+\S+/)?.[1];
        return list ? parseVlanList(list) : table ? [Number(table)] : /^\s*[\d, -]+\s*$/.test(line) ? parseVlanList(line) : [];
      }))];
      if (!vlans.length) {
        result.evidence.network = evidence('unknown', 'show vlan', 'Formato VLAN no reconocido; preflight inconcluso.');
        throw new Error('No se pudo comprobar la VLAN de gestión en la OLT.');
      }
      if (!vlans.includes(config.tr069Vlan!)) throw new Error('La VLAN de gestión no existe en la OLT.');
      result.evidence.network = evidence('confirmed', 'show vlan', 'VLAN existente; uplink y DHCP requieren diagnóstico independiente.');
      let knownUplinks = 0, matchingUplinks = 0;
      for (const uplink of config.tr069Uplinks || []) {
        if (!/^(?:gei|xgei)_\d+\/\d+\/\d+$/.test(uplink)) throw new Error('Nombre de uplink no admitido por la CLI ZTE.');
        try {
          const raw = await executor.run('show vlan port ' + uplink);
          const tagged = raw.match(/^TaggedVlan:[ \t]*([\s\S]*)$/im);
          const untagged = raw.match(/^UntaggedVlan:[ \t]*([\s\S]*?)^[ \t]*TaggedVlan:/im);
          if (tagged && untagged) {
            knownUplinks++;
            if ([...parseVlanList(tagged[1]), ...parseVlanList(untagged[1])].includes(config.tr069Vlan!)) matchingUplinks++;
          }
        } catch (error) { if (!executor.isUsable()) throw error; }
      }
      if ((config.tr069Uplinks?.length || 0) > 0 && knownUplinks === config.tr069Uplinks!.length && !matchingUplinks) throw new Error('La VLAN de gestión no está presente en los uplinks registrados.');
      let snoopingKnown = false;
      try {
        const snooping = await executor.run('show ip dhcp snooping global');
        snoopingKnown = /(?:dhcp|snooping)[\s\S]*(?:enable|disable)/i.test(snooping);
      } catch (error) { if (!executor.isUsable()) throw error; }
      result.evidence.network = evidence(matchingUplinks && snoopingKnown ? 'confirmed' : 'unknown', 'network-preflight',
        `VLAN existente; uplink ${matchingUplinks ? 'con VLAN observada' : 'sin evidencia concluyente'}; DHCP snooping ${snoopingKnown ? 'consultado sin modificar' : 'no verificable'}. No se exige activarlo.`);
    }
    result.stage = 'configuration';
    await config.onTr069Stage?.(result.stage);
    for (const step of plan) {
      if (scope !== step.scope) {
        if (scope) await executor.run('end');
        await enter(executor, iface, step.scope);
        scope = step.scope;
      }
      await executor.run(step.command, step.scope, { absentOk: step.command.startsWith('no ') });
      applied.push(step);
    }
    if (scope) { await executor.run('end'); scope = undefined; }
    // Readback must agree before claiming the configuration was applied.
    const observed = parseTr069State(await executor.run('show running-config'), iface, config.serialNumber);
    if (buildTr069Plan(config, observed, acsOnly).length) throw new Error('La lectura posterior no coincide con la configuración solicitada.');
    result.configurationStatus = 'confirmed';
    result.evidence.configuration = evidence('confirmed', 'running-config');
    result.stage = 'persistence';
    await config.onTr069Stage?.(result.stage);
    await executor.run('write');
    result.persistenceStatus = 'confirmed';
    result.evidence.persistence = evidence('confirmed', 'write', 'La CLI confirmó el guardado; no se verificó mediante reinicio.');
    result.ok = true;
    result.status = 'applied_unverified';
    result.stage = 'verification';
    await config.onTr069Stage?.(result.stage);
    // Queries are evidence only: no additional mutations or reboots on failure.
    for (const wait of [0, 5000, 10000]) {
      if (wait) await executor.pause(wait);
      const detail = parseOnuDetailInfo(await executor.run('show gpon onu detail-info ' + iface));
      if (!detail.configState || !detail.phaseState) {
        result.evidence.omci = evidence('unknown', 'detail-info', 'Respuesta de estado incompleta.');
      } else {
        const success = detail.configState.toLowerCase() === 'success' && detail.phaseState.toLowerCase() === 'working';
        result.evidence.omci = evidence(success ? 'confirmed' : 'failed', 'detail-info', 'Config: ' + detail.configState + '; fase: ' + detail.phaseState);
        if (success) break;
      }
    }
    const host = parseIpHost(await executor.run('show gpon remote-onu ip-host ' + iface));
    const validIp = !!host.mgmtIp && isIP(host.mgmtIp) === 4 && !/^(0\.|127\.|169\.254\.|255\.)/.test(host.mgmtIp);
    result.evidence.ip = evidence(validIp ? 'confirmed' : host.ipHostFound ? 'failed' : 'unknown', 'ip-host', validIp ? 'IP de gestión: ' + host.mgmtIp : 'IP de gestión no confirmada.');
    result.evidence.acs = evidence('unknown', 'GenieACS', 'Pendiente de Inform nuevo en el ACS de destino.');
  } catch (error) {
    const message = executor.safe(String((error as Error).message));
    const code = error instanceof ZteCommandError ? error.code : 'PRECONDITION_OR_READBACK';
    result.issues.push({ code, stage: result.stage, message });
    logger.warn('[TR069] ' + result.stage + ': ' + message);
    if (result.ok) {
      // Configuration was persisted; a monitoring failure must remain visible.
      result.warning = message;
    } else {
      result.status = executor.mutations > 0 ? 'partial' : 'failed';
      result.error = message;
      if (result.stage === 'persistence') {
        result.persistenceStatus = error instanceof ZteCommandError && error.indeterminate ? 'unknown' : 'failed';
        result.evidence.persistence = evidence(result.persistenceStatus, 'write', message);
      } else if (!(error instanceof ZteCommandError && error.indeterminate)) {
        result.configurationStatus = 'failed';
        result.evidence.configuration = evidence('failed', result.stage, message);
      }
      const uncertain = error instanceof ZteCommandError && error.indeterminate;
      if (applied.length && executor.isUsable() && !uncertain && result.stage !== 'persistence') {
        try {
          if (scope) { await executor.run('end'); scope = undefined; }
          for (const step of [...applied].reverse()) {
            if (!step.undo.length) continue;
            await enter(executor, iface, step.scope);
            for (const undo of step.undo) await executor.run(undo, step.scope, { absentOk: undo.startsWith('no ') });
            await executor.run('end');
          }
          await executor.run('write');
          result.issues.push({ code: 'COMPENSATION_ATTEMPTED', stage: 'compensation', message: 'Se restauraron los valores anteriores conocidos; revisar diferencias antes de reintentar.' });
        } catch (rollbackError) {
          result.issues.push({ code: 'COMPENSATION_UNKNOWN', stage: 'compensation', message: executor.safe(String((rollbackError as Error).message)) });
        }
      }
    }
  }
  result.attempts = executor.attempts;
  result.durationMs = Date.now() - started;
  if (result.ok && result.status !== 'verified') result.warning = result.warning || 'Configuración aplicada; comunicación ACS aún sin verificar.';
  return result;
}

export async function applyTr069ManagementWithSession(
  session: ZteSessionLike, config: AuthorizeOnuParams, logger: Logger, delay: DelayFn = defaultDelay,
): Promise<Tr069Result> {
  return provision(session, config, logger, delay, false);
}
export async function updateTr069AcsUrlWithSession(
  session: ZteSessionLike,
  config: { ponInterface: string; onuId: number; tr069Url: string; serialNumber?: string; tr069AcsUsername?: string; tr069AcsPassword?: string },
  logger: Logger = new Logger('Tr069'), delay: DelayFn = defaultDelay,
): Promise<Tr069Result> {
  return provision(session, config as AuthorizeOnuParams, logger, delay, true);
}
