import { Logger } from '@nestjs/common';
import { AuthorizeOnuParams } from '../ports/olt-driver.port';
import { ZteSessionLike } from './zte-telnet-session';
import { isOltErrorResponse, isAlreadyAppliedResponse, parseOnuDetailInfo } from './zte-c320-parsers';
import {
  generateTr069ManagementScript,
  generateTr069TransportScript,
  toOnuInterfaceName,
  SWITCHPORT_BIND_RE,
  isPreparatoryTeardownCommand,
} from './zte-c320-provisioning-scripts';

/**
 * Etapa 2 del flujo de 3 etapas (apuntar la ONU al ACS/TR-069) -- extraído
 * de `zte-c320.driver.ts` (Fase 5 de Plan_Implementacion_Refactor_ZteC320Driver.md):
 * `applyTr069Management`, `updateTr069AcsUrl`.
 * Aplicar configuración no reinicia la ONU; el reinicio es una acción explícita.
 */

type DelayFn = (ms: number) => Promise<void>;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pausa deliberada de 6 a 10 segundos para aprovisionamiento TR-069 / OMCI en ZTE C320.
 * Previene colisiones de comandos, desbordamiento de buffers de entrada y permite
 * que la MIB OMCI de la ONU sincronice adecuadamente en hardware óptico.
 */
export function getTr069PacingDelay(cmd: string): number {
  if (cmd === 'write') {
    return 8000; // 8s tras write para consolidar cambios en memoria no volátil
  }
  if (cmd.startsWith('pon-onu-mng ') || cmd.startsWith('interface gpon-onu_')) {
    return 6000; // 6s para asentamiento tras cambio de modo
  }
  if (cmd === 'exit' || cmd === 'end') {
    return 1500;
  }
  if (cmd === 'configure terminal') {
    return 2000;
  }
  // Para comandos OMCI y transporte (flows, binds, ip-host, tr069-mgmt, security-mgmt, tcont, gemport, service-port)
  return 6000;
}


/**
 * Prepara la capa de TRANSPORTE del canal de gestión/TR-069 (tcont 2/
 * gemport 2/service-port 2) -- necesario desde que "Autorizar ONU en la
 * OLT" (Etapa 1) dejó de crearla (decisión de negocio 2026-10-30: se quitó
 * el selector de Red TR-069 de ese modal para que Etapa 1 sea siempre SOLO
 * Internet, evitando la confusión de no saber qué paso falló dentro de una
 * sesión atómica mezclando dos canales). Sin esto, Etapa 2 asumía que esta
 * capa ya existía (ver la nota de `updateTr069AcsUrlWithSession`) y fallaba
 * en seco al referenciar un "gemport 2" que nunca se creó -- el mismo bug
 * que originalmente motivó fusionar ambas etapas en una sola sesión
 * (CONFIRMADO EN VIVO, 2026-10-24, ONU CMDCDD4D131E). Ahora Etapa 2 es
 * autosuficiente: crea esta capa ella misma, en su PROPIA sesión, "no
 * service-port 2" antes de recrearlo igual que Etapa 1 (ver
 * generateAuthorizationScript) para evitar el desajuste de VLAN entre
 * capas confirmado en vivo el 2026-10-30.
 *
 * Ejecuta "configure terminal"/"write" con el MISMO pacing humano
 * (`getHumanPacingDelay`) y el mismo reintento ante glitch de buffer
 * (`%Error 20200`) que ya usan `authorizeOnu()` y el bucle OMCI de abajo --
 * BUG REAL CONFIRMADO EN VIVO (2026-10-30, ONU CMDCDD4D131E): esta función
 * no tenía NINGÚN pacing entre comandos, así que su "write" final (que
 * puede tardar en asentarse, igual que el de `authorizeOnu()`) quedaba
 * seguido INMEDIATAMENTE por el "configure terminal" del bloque OMCI de
 * `applyTr069ManagementWithSession` -- la OLT rechazó ese "configure
 * terminal" con "%Error 20200: Invalid input detected at '^' marker",
 * dejando el resto del bloque OMCI sin aplicarse de verdad pese a que
 * ningún comando individual fue reportado como rechazo fatal (tratado como
 * mejor esfuerzo por estar `inTr069Block`).
 */
export async function ensureTr069TransportWithSession(
  session: ZteSessionLike,
  config: AuthorizeOnuParams,
  delay: DelayFn = defaultDelay,
): Promise<void> {
  if (!config.tr069Vlan) {
    throw new Error('No se puede preparar el canal de gestión/TR-069: falta la VLAN de TR-069 (tr069Vlan).');
  }

  // Literales de comando sacados de `generateTr069TransportScript()` --
  // fuente única de verdad compartida con el botón "Previsualizar Script
  // CLI" de Etapa 2, para que la vista previa nunca pueda divergir de lo
  // que esta sesión real ejecuta.
  // Directriz del sistema: NO auto-crear perfiles automáticamente en la OLT.
  // gemport 2 no requiere límite downstream.
  const [
    cmdConfigTerminal,
    cmdInterface,
    cmdTcont,
    cmdGemportTcont,
    cmdNoServicePort,
    cmdServicePort,
    cmdExitInterface,
    cmdExitConfig,
    cmdWrite,
  ] = generateTr069TransportScript(config);

  const runPaced = async (cmd: string): Promise<string> => {
    let output = await session.executeCommand(cmd);
    // Mismo reintento ante glitch de buffer que authorizeOnu() -- un
    // "%Error 20200" no es un rechazo lógico real, es una colisión de
    // entrada (ver nota de getHumanPacingDelay sobre el banner %Info 20272).
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

  await runPaced(cmdConfigTerminal);
  // Configuración de DHCP Snooping en la OLT para la VLAN de gestión TR-069 (CRÍTICO - Bloque 3):
  // Asegura que DHCP snooping esté activo en la VLAN con control-port disable
  // para permitir que los paquetes DHCP del iphost 2 lleguen al servidor DHCP en MikroTik.
  try {
    await session.executeCommand('ip dhcp snooping enable');
    await session.executeCommand(`ip dhcp snooping vlan ${config.tr069Vlan}`);
    await session.executeCommand('ip dhcp snooping control-port disable');
  } catch {
    /* best-effort */
  }
  const ifaceOutput = await runPaced(cmdInterface);
  if (isOltErrorResponse(ifaceOutput)) {
    try {
      await session.executeCommand('end');
    } catch {
      /* best-effort */
    }
    throw new Error(`La OLT rechazó entrar a "${cmdInterface}": ${ifaceOutput.trim()}`);
  }

  const tcontOutput = await runPaced(cmdTcont);
  if (isOltErrorResponse(tcontOutput) && !isAlreadyAppliedResponse(tcontOutput)) {
    try {
      await session.executeCommand('exit');
    } catch {
      /* best-effort */
    }
    throw new Error(`La OLT rechazó "${cmdTcont}": ${tcontOutput.trim()}`);
  }

  await runPaced(cmdGemportTcont);

  // "no service-port 2" ANTES de crearlo -- mismo criterio que
  // generateAuthorizationScript (CONFIRMADO EN VIVO, 2026-10-30, ONU
  // CMDCDD4D131E): destruir y recrear limpio evita que quede apuntando a
  // una VLAN vieja de un intento anterior con otra Red TR-069. Puramente
  // preparatorio -- nunca fatal, sin importar lo que responda la OLT.
  await runPaced(cmdNoServicePort);
  const servicePortOutput = await runPaced(cmdServicePort);
  if (isOltErrorResponse(servicePortOutput) && !isAlreadyAppliedResponse(servicePortOutput)) {
    try {
      await session.executeCommand('exit');
    } catch {
      /* best-effort */
    }
    throw new Error(`La OLT rechazó "${cmdServicePort}": ${servicePortOutput.trim()}`);
  }

  // Cierre ordenado de sub-vistas (interface -> configure terminal -> EXEC)
  // ANTES de "write" -- BUG REAL CONFIRMADO EN VIVO (2026-10-30, ONU
  // CMDCDD4D131E): con un solo "exit" la sesión se quedaba en "(config)#" en
  // vez de volver a EXEC, así que el "configure terminal" del bloque OMCI
  // (generateTr069ManagementScript, ejecutado justo después en
  // applyTr069ManagementWithSession) se mandaba estando YA en modo config --
  // la OLT lo rechazaba ahí con "%Error 20200: Invalid input detected at
  // '^' marker" (comando ejecutado en el nivel de CLI incorrecto, no un
  // glitch de timing). Ver generateTr069TransportScript.
  await runPaced(cmdExitInterface);
  await runPaced(cmdExitConfig);
  await runPaced(cmdWrite);
}

/**
 * Aplica SOLO el bloque OMCI que apunta la ONU al ACS (TR-069) -- Etapa 2
 * del flujo de 3 etapas, separada de `authorizeOnu()` para poder
 * reintentarse sin re-autorizar la ONU ópticamente. Asume que la ONU ya
 * está autorizada en la OLT (vport1/service-port1 ya existen).
 *
 * Trata el bloque completo como MEJOR ESFUERZO, no crítico -- mismo
 * criterio que `cpeConfigWarning` del lado del servicio. Confirmado en
 * vivo contra OLT_Tabara_Abajo (2026-10-20) que la OLT puede aceptar el
 * comando pero el ONT lo rechace a nivel OMCI ("%Code 63990-GPONRM : ONT
 * return error: command processing error."). CAUSA RAÍZ CONFIRMADA
 * (2026-10-22): el onu-type del ONT tenía "Max VEIP: 0" -- `veip 1 port
 * udp 1232 host 2` exige que el onu-type soporte al menos 1 VEIP.
 * `ensureOnuTypeProfileWithSession` ya incluye "max-veip 1" para
 * onu-types NUEVOS (ver esa nota), pero esto solo arregla casos futuros:
 * un onu-type que ya existía en la OLT (ej. HUAWEY-HG8145V5 en
 * OLT_Tabara_Abajo) sigue con "Max VEIP: 0" hasta corregirse a mano. Por
 * eso este bloque se mantiene como mejor esfuerzo -- un rechazo acá nunca
 * debe impedir que el admin vea el resultado -- se reporta como
 * `warning`, no como `error` duro, igual que antes hacía `authorizeOnu()`
 * con este mismo bloque.
 */
export async function applyTr069ManagementWithSession(
  session: ZteSessionLike,
  config: AuthorizeOnuParams,
  logger: Logger,
  delay: DelayFn = defaultDelay,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  // Decisión de negocio (2026-10-30): "Autorizar ONU en la OLT" (Etapa 1)
  // ya NO crea tcont2/gemport2/service-port2 -- se quitó el selector de Red
  // TR-069 de ese modal para que Etapa 1 sea SIEMPRE solo Internet (menos
  // confuso: una sola sesión mezclando dos canales dificultaba saber cuál
  // paso había fallado). Etapa 2 ahora se asegura esta capa ELLA MISMA, en
  // su propia sesión -- autosuficiente, sin depender de que Etapa 1 la haya
  // tocado antes. Si esto falla, es fatal (no mejor esfuerzo): el resto del
  // bloque OMCI de abajo referencia "gemport 2", que no existe sin esto.
  await ensureTr069TransportWithSession(session, config, delay);
  // Pausa deliberada de 6s para asentar la capa de transporte antes del bloque OMCI
  await delay(6000);

  const commands = generateTr069ManagementScript(config);
  // Acumula TODOS los rechazos de la corrida, no solo el primero -- antes
  // `warning` se fijaba una sola vez (`if (!warning)`) y cualquier
  // rechazo posterior en la MISMA corrida quedaba invisible (ni
  // siquiera en los logs del servidor, porque el `logger.warn` también
  // estaba adentro de ese guard). Eso obligaba a descubrir las
  // incompatibilidades OMCI de un modelo de a una por reintento en vez
  // de verlas todas de una vez (confirmado en vivo, 2026-10-28, ONU
  // ECOM0F91DF9B/HUAWEY-BT546XG: "dhcp-ip ethuni" y "security-mgmt"
  // fueron rechazados en la misma corrida, pero solo el primero se
  // reportó).
  const warnings: string[] = [];
  // TODO el script generado por generateTr069ManagementScript() es el
  // bloque TR-069 (así lo documenta este método) -- antes el flag solo se
  // activaba al llegar a "pon-onu-mng", así que un rechazo en los
  // comandos previos (tcont 2/gemport 2/service-port 2, el segundo
  // camino de datos GPON) era tratado como fatal y abortaba toda la
  // Etapa 2 sin reportar un warning reintentable (bug real confirmado
  // por revisión de código, 2026-10-23).
  const inTr069Block = true;

  for (const cmd of commands) {
    // El ACS sigue el mismo flujo de ejecución y pacing que el resto de OMCI.
    // Los rechazos se reportan sin ciclos de reinicio/reintento de la ONU.
    // Comandos "no ..." puramente preparatorios (destruir antes de
    // recrear, ver isPreparatoryTeardownCommand) -- mismo criterio que
    // "no service-port 2" en ensureTr069TransportWithSession: nunca deben
    // generar un `warning` confuso, sin importar lo que responda la OLT
    // (típicamente "no existe" la primera vez que se aplica el perfil
    // TR-069 a esta ONU).
    if (isPreparatoryTeardownCommand(cmd)) {
      await session.executeCommand(cmd);
      const pacingMs = getTr069PacingDelay(cmd);
      if (pacingMs > 0) {
        await delay(pacingMs);
      }
      continue;
    }

    let output = await session.executeCommand(cmd);

    // Simulación humana: si hubo un choque de buffer de entrada (%Error
    // 20200), reintentar una vez -- mismo criterio que authorizeOnu().
    // CONFIRMADO EN VIVO (2026-10-30, ONU CMDCDD4D131E): sin este reintento,
    // un glitch de buffer entre la capa de transporte (ensureTr069Transport-
    // WithSession) y este bloque OMCI dejaba "configure terminal" rechazado
    // y el resto del bloque sin aplicarse de verdad (Config state: fail).
    if (output.includes('%Error 20200')) {
      logger.warn(`[human-sim] applyTr069Management: reintentando comando "${cmd}" tras detectar glitch de input %Error 20200`);
      await delay(350);
      output = await session.executeCommand(cmd);
    }

    // Pacing deliberado de 6 a 10 segundos entre comandos OMCI
    const pacingMs = getTr069PacingDelay(cmd);
    if (pacingMs > 0) {
      await delay(pacingMs);
    }

    if (isOltErrorResponse(output)) {
      if (isAlreadyAppliedResponse(output) && SWITCHPORT_BIND_RE.test(cmd)) {
        // BUG REAL CONFIRMADO EN VIVO (2026-11-03, ONU CMDCDD4D131E): tolerar
        // "ya existe" a ciegas en "switchport-bind switch_0/1 iphost 2" dejó
        // el running-config SIN ese bind pese a que "ip-host 2 dhcp-enable
        // ..." sí quedó aplicado -- el canal de gestión queda con DHCP
        // habilitado pero sin bind real, así que nunca recibe el DHCP. Se
        // fuerza un re-enlace limpio en vez de confiar ciegamente (ver
        // SWITCHPORT_BIND_RE).
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
        // ok, ya aplicado en un intento anterior -- seguir con el resto.
      } else if (inTr069Block) {
        const msg =
          `La OLT rechazó la configuración TR-069/ACS ("${cmd}"): ${output.trim()}. ` +
          'Probablemente debas configurar el WAN manualmente en la ONU.';
        warnings.push(msg);
        logger.warn(`[diag] applyTr069Management: TR-069/ACS best-effort falló, continuando: ${msg}`);
        // No se relanza: el resto del script (incluido "end" para salir
        // limpio de "(gpon-onu-mng)#" y el "write" final) debe seguir
        // corriendo igual.
      } else {
        throw new Error(`La OLT rechazó el comando "${cmd}": ${output.trim()}`);
      }
    }
  }

  // Consultar la convergencia OMCI tras aplicar y guardar, sin reiniciar la ONU.
  // Las pausas suman 45s; la duración de las consultas se añade a ese tiempo.
  const CONFIG_STATE_POLL_DELAYS_MS = [5000, 10000, 15000, 15000];
  const onuInterface = toOnuInterfaceName(config.ponInterface, config.onuId);
  let lastConfigState: string | undefined;
  let lastReadError: string | undefined;

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
      'La sincronización OMCI puede seguir pendiente tras aplicar los cambios. ' +
      'Verifica en el MikroTik si la ONT ya obtuvo IP en la VLAN de gestión (' +
      (config.tr069Vlan ?? '444') +
      ').';
    warnings.push(configStateWarning);
    logger.warn(`[diag] applyTr069Management: ${configStateWarning}`);
  }

  return { ok: true, warning: warnings.length > 0 ? warnings.join(' | ') : undefined };
}

/**
 * Versión aislada de `applyTr069Management` que SOLO toca el puntero del
 * ACS -- no vuelve a tocar tcont 2/gemport 2/service-port 2/flow 2/
 * vlan-filter iphost 2/veip 1 (eso lo deja intacto; debe haberse aplicado
 * antes vía `applyTr069Management`). Nace porque tratar un rechazo de
 * "tr069-mgmt ... acs ..." como mejor esfuerzo (ver esa nota) hacía que
 * ESTA acción puntual -- "solo quiero cambiar a qué ACS apunta" -- nunca
 * reportara un fallo real, incluso cuando la OLT lo rechazaba de plano.
 */
export async function updateTr069AcsUrlWithSession(
  session: ZteSessionLike,
  config: {
    ponInterface: string;
    onuId: number;
    tr069Url: string;
    tr069AcsUsername?: string;
    tr069AcsPassword?: string;
  },
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const onuInterface = toOnuInterfaceName(config.ponInterface, config.onuId);

  await session.executeCommand('configure terminal');
  const pomOutput = await session.executeCommand(`pon-onu-mng ${onuInterface}`);
  if (isOltErrorResponse(pomOutput)) {
    throw new Error(`La OLT rechazó entrar a "pon-onu-mng ${onuInterface}": ${pomOutput.trim()}`);
  }

  // Mismo formato que `generateTr069ManagementScript` -- "acs <url>" y
  // "validate basic username/password" van en un solo comando (eso sí es
  // correcto; lo separado de "tag pri ... vlan ..." es otro comando
  // aparte, que este método no toca).
  const acsCmd =
    config.tr069AcsUsername && config.tr069AcsPassword
      ? `tr069-mgmt 1 acs ${config.tr069Url} validate basic username ${config.tr069AcsUsername} password ${config.tr069AcsPassword}`
      : `tr069-mgmt 1 acs ${config.tr069Url}`;
  const acsOutput = await session.executeCommand(acsCmd);
  if (isOltErrorResponse(acsOutput) && !isAlreadyAppliedResponse(acsOutput)) {
    // Error DURO a propósito -- ver el comentario de la interfaz
    // (`updateTr069AcsUrl` en olt-driver.port.ts) sobre por qué esta
    // única pieza no se trata como mejor esfuerzo.
    throw new Error(`La OLT rechazó "tr069-mgmt 1 acs": ${acsOutput.trim()}`);
  }

  // Persistir el cambio sin reiniciar la ONU.
  await session.executeCommand('end');
  await session.executeCommand('write');

  return { ok: true };
}
