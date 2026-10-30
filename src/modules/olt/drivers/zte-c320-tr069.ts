import { Logger } from '@nestjs/common';
import { AuthorizeOnuParams } from '../ports/olt-driver.port';
import { ZteSessionLike } from './zte-telnet-session';
import { isOltErrorResponse, isAlreadyAppliedResponse, parseOnuDetailInfo } from './zte-c320-parsers';
import {
  generateTr069ManagementScript,
  generateTr069TransportScript,
  toOnuInterfaceName,
  getHumanPacingDelay,
  REBOOT_ONU_SENTINEL,
  FLOW_SWITCH_BIND_RE,
} from './zte-c320-provisioning-scripts';
import { ensureTcontProfileWithSession, ensureTrafficProfileWithSession } from './zte-c320-profiles';

/**
 * Etapa 2 del flujo de 3 etapas (apuntar la ONU al ACS/TR-069) -- extraído
 * de `zte-c320.driver.ts` (Fase 5 de Plan_Implementacion_Refactor_ZteC320Driver.md):
 * `applyTr069Management`, `applyAcsUrlWithRetries`, `updateTr069AcsUrl`.
 */

type DelayFn = (ms: number) => Promise<void>;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 */
export async function ensureTr069TransportWithSession(session: ZteSessionLike, config: AuthorizeOnuParams): Promise<void> {
  if (!config.tr069Vlan) {
    throw new Error('No se puede preparar el canal de gestión/TR-069: falta la VLAN de TR-069 (tr069Vlan).');
  }

  await ensureTcontProfileWithSession(session, { name: 'SMARTOLT-VOIPMNG-10M', fixedKbps: 10240 });
  await ensureTrafficProfileWithSession(session, { name: 'SMARTOLT-VOIPMNG-10M', downKbps: 10240 });

  // Literales de comando sacados de `generateTr069TransportScript()` --
  // fuente única de verdad compartida con el botón "Previsualizar Script
  // CLI" de Etapa 2, para que la vista previa nunca pueda divergir de lo
  // que esta sesión real ejecuta.
  const [
    cmdConfigTerminal,
    cmdInterface,
    cmdTcont,
    cmdGemportTcont,
    cmdGemportTrafficLimit,
    cmdNoServicePort,
    cmdServicePort,
    cmdExit,
    cmdWrite,
  ] = generateTr069TransportScript(config);

  await session.executeCommand(cmdConfigTerminal);
  const ifaceOutput = await session.executeCommand(cmdInterface);
  if (isOltErrorResponse(ifaceOutput)) {
    try {
      await session.executeCommand('end');
    } catch {
      /* best-effort */
    }
    throw new Error(`La OLT rechazó entrar a "${cmdInterface}": ${ifaceOutput.trim()}`);
  }

  const tcontOutput = await session.executeCommand(cmdTcont);
  if (isOltErrorResponse(tcontOutput) && !isAlreadyAppliedResponse(tcontOutput)) {
    try {
      await session.executeCommand('exit');
    } catch {
      /* best-effort */
    }
    throw new Error(`La OLT rechazó "${cmdTcont}": ${tcontOutput.trim()}`);
  }

  await session.executeCommand(cmdGemportTcont);
  await session.executeCommand(cmdGemportTrafficLimit);

  // "no service-port 2" ANTES de crearlo -- mismo criterio que
  // generateAuthorizationScript (CONFIRMADO EN VIVO, 2026-10-30, ONU
  // CMDCDD4D131E): destruir y recrear limpio evita que quede apuntando a
  // una VLAN vieja de un intento anterior con otra Red TR-069. Puramente
  // preparatorio -- nunca fatal, sin importar lo que responda la OLT.
  await session.executeCommand(cmdNoServicePort);
  const servicePortOutput = await session.executeCommand(cmdServicePort);
  if (isOltErrorResponse(servicePortOutput) && !isAlreadyAppliedResponse(servicePortOutput)) {
    try {
      await session.executeCommand('exit');
    } catch {
      /* best-effort */
    }
    throw new Error(`La OLT rechazó "${cmdServicePort}": ${servicePortOutput.trim()}`);
  }

  await session.executeCommand(cmdExit);
  await session.executeCommand(cmdWrite);
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
  await ensureTr069TransportWithSession(session, config);

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
  // Se pone en `true` dentro de `applyAcsUrlWithRetries()` -- evita que
  // el REBOOT_ONU_SENTINEL de más abajo dispare un reinicio EXTRA e
  // innecesario cuando el reintento del ACS ya reinició el ONT una o
  // varias veces por su cuenta (ver esa nota).
  let acsRebootHandled = false;

  for (const cmd of commands) {
    if (cmd === REBOOT_ONU_SENTINEL) {
      if (acsRebootHandled) {
        continue;
      }
      // No es un comando CLI -- ver REBOOT_ONU_SENTINEL. Mismo criterio
      // de mejor esfuerzo que el resto del bloque TR-069: si el ONT no
      // confirma el reinicio a tiempo, no debe tumbar el resultado
      // completo (la OLT ya aceptó la configuración).
      try {
        await session.rebootOnu();
      } catch (err: any) {
        const msg = `No se pudo confirmar el reinicio OMCI del ONT tras configurar TR-069: ${err.message}. La configuración sí se aplicó en la OLT.`;
        warnings.push(msg);
        logger.warn(`[diag] applyTr069Management: rebootOnu() best-effort falló, continuando: ${msg}`);
      }
      continue;
    }

    // Confirmado en vivo (2026-10-23): el rechazo real de este comando
    // ("%Code 63990-GPONRM") no es un problema de sintaxis -- es que el
    // ONT necesita, en algunos casos, varios ciclos de reinicio OMCI
    // antes de aceptar el puntero del ACS, incluso con la secuencia de
    // comandos ya confirmada idéntica a la de un proveedor externo
    // (SmartOLT) que sí funciona. Antes este comando se trataba como un
    // intento único (mejor esfuerzo); ahora se reintenta con reinicio
    // varias veces dentro de la MISMA llamada, en vez de depender de que
    // un job externo (GenieAcsReconciliationService) lo reintente solo
    // cada 10-30 minutos -- confirmado que eso tardó casi una hora sin
    // éxito en producción (2026-10-23) hasta una intervención manual.
    const isAcsCommand = cmd.startsWith('tr069-mgmt') && cmd.includes(' acs ');
    if (isAcsCommand) {
      const acsResult = await applyAcsUrlWithRetries(session, logger, cmd, delay);
      acsRebootHandled = true;
      if (acsResult.warningMessage) {
        warnings.push(acsResult.warningMessage);
      }
      continue;
    }

    const output = await session.executeCommand(cmd);

    // Pacing humano entre comandos
    const pacingMs = getHumanPacingDelay(cmd);
    if (pacingMs > 0) {
      await delay(pacingMs);
    }

    if (isOltErrorResponse(output)) {
      if (isAlreadyAppliedResponse(output) && FLOW_SWITCH_BIND_RE.test(cmd)) {
        // Mismo criterio que `authorizeOnu()` (zte-c320.driver.ts, canal 1)
        // -- CONFIRMADO EN VIVO (2026-10-30, ONU CMDCDD4D131E) que tolerar
        // "ya existe" a ciegas en "flow <N> switch switch_0/1" puede dejar
        // un enlace de un intento ANTERIOR sin verificar realmente
        // conmutando tráfico. Tras el desacople de Etapa 1/Etapa 2
        // (2026-10-30), esta es la ÚNICA sesión donde "flow 2 switch
        // switch_0/1" se aplica, así que necesita la misma protección que
        // ya tenía el canal 1.
        logger.warn(`[diag] applyTr069Management: "${cmd}" ya existía -- forzando re-enlace limpio por si quedó de un intento anterior`);
        try {
          await session.executeCommand(cmd.replace(/^flow (\d+) switch/, 'no flow $1 switch'));
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

  // Verificación real post-aplicación -- CONFIRMADO EN VIVO (2026-10-23)
  // comparando contra running-config reales de SmartOLT: una ONU puede
  // terminar con "tr069-mgmt"/"veip 1 ... host 2" apuntando a un
  // "iphost 2" que en realidad NUNCA se llegó a crear (faltaba TODO el
  // bloque "flow 2"/"gemport 2 flow 2"/"switchport-bind ... iphost 2"/
  // "ip-host 2 dhcp-enable"/"vlan-filter ... iphost 2"), sin que la OLT
  // devolviera ningún "%Error"/"%Code" detectable en ese momento -- el
  // "mejor esfuerzo" de este método no detectaba nada raro y devolvía
  // `ok:true` sin ningún `warning`, un éxito completamente falso. "Config
  // state" en `show gpon onu detail-info` es la señal real y ya probada
  // de si el ONT aceptó TODO el bloque OMCI, no solo el comando puntual
  // del ACS -- se revisa acá, después del reinicio final, en vez de
  // confiar en que "ningún comando devolvió error" sea suficiente.
  const onuInterface = toOnuInterfaceName(config.ponInterface, config.onuId);
  try {
    const detailOutput = await session.executeCommand(`show gpon onu detail-info ${onuInterface}`);
    const configState = parseOnuDetailInfo(detailOutput).configState;
    if (configState && configState.toLowerCase() !== 'success') {
      const configStateWarning =
        `El "Config state" del ONT quedó en "${configState}" (no "success") tras aplicar el bloque TR-069 -- ` +
        'es posible que el canal de gestión (iphost 2/VEIP) no se haya terminado de aplicar pese a que ' +
        'ningún comando individual fue rechazado. Revisa manualmente o reintenta la Etapa 2.';
      warnings.push(configStateWarning);
      logger.warn(`[diag] applyTr069Management: ${configStateWarning}`);
    }
  } catch (err: any) {
    // Mejor esfuerzo -- no poder leer el Config state no debe tumbar un
    // resultado que, por lo demás, no tuvo ningún rechazo real.
    logger.warn(`[diag] applyTr069Management: no se pudo verificar "Config state": ${err.message}`);
  }

  return { ok: true, warning: warnings.length > 0 ? warnings.join(' | ') : undefined };
}

/**
 * Reintenta "tr069-mgmt 1 acs <url>" con reinicio OMCI entre cada intento
 * -- construido tras confirmar en vivo (2026-10-23) que ni la secuencia de
 * comandos ni el orden son el problema (son idénticos a los de SmartOLT,
 * que sí funciona): lo que distingue un intento exitoso de uno rechazado
 * es, simplemente, cuántas veces se reintentó con reinicio de por medio.
 * `maxAttempts`/`delayMs` son conservadores a propósito -- cada intento
 * rechazado cuesta un reinicio OMCI (~20-30s hasta volver a "working") más
 * el delay; con los valores por defecto (6 intentos, 20s) el peor caso
 * ronda los 2-2.5 minutos dentro de esta misma llamada HTTP. Si el proxy
 * balanceador delante del backend tiene un timeout más corto que eso,
 * hay que bajar `maxAttempts` o mover este reintento a un job asíncrono.
 */
export async function applyAcsUrlWithRetries(
  session: ZteSessionLike,
  logger: Logger,
  acsCmd: string,
  delay: DelayFn = defaultDelay,
  maxAttempts = 6,
  delayMs = 20000,
): Promise<{ accepted: boolean; warningMessage?: string }> {
  let lastRejection: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const output = await session.executeCommand(acsCmd);
    const accepted = !isOltErrorResponse(output) || isAlreadyAppliedResponse(output);

    if (accepted) {
      logger.log(`[diag] applyAcsUrlWithRetries: ACS aceptado en el intento ${attempt}/${maxAttempts}.`);
    } else {
      lastRejection = output.trim();
      logger.warn(
        `[diag] applyAcsUrlWithRetries: intento ${attempt}/${maxAttempts} rechazado ("${acsCmd}"): ${lastRejection}`,
      );
    }

    // Reinicio obligatorio tras CADA intento -- aceptado o no. Los SET de
    // OMCI de este ONT no son idempotentes y no toman efecto real sin
    // reiniciar (mismo motivo por el que REBOOT_ONU_SENTINEL siempre lo
    // hacía antes de este cambio) -- un intento "aceptado" en la OLT
    // igual necesita este reinicio para que el ONT lo aplique de verdad.
    // Mejor esfuerzo: un timeout confirmando el reinicio no debe tumbar un
    // resultado ya aceptado, pero sí se reporta como warning.
    let rebootWarning: string | undefined;
    try {
      await session.rebootOnu();
    } catch (err: any) {
      rebootWarning = `No se pudo confirmar el reinicio OMCI del ONT: ${err.message}.`;
      logger.warn(
        `[diag] applyAcsUrlWithRetries: rebootOnu() best-effort falló en el intento ${attempt}: ${err.message}`,
      );
    }

    if (accepted) {
      return { accepted: true, warningMessage: rebootWarning };
    }

    if (attempt < maxAttempts) {
      await delay(delayMs);
    }
  }

  return {
    accepted: false,
    warningMessage:
      `La OLT rechazó la configuración TR-069/ACS ("${acsCmd}") tras ${maxAttempts} intentos con reinicio: ` +
      `${lastRejection}. Probablemente debas configurar el WAN manualmente en la ONU.`,
  };
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
  logger: Logger,
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

  // El reinicio SÍ sigue siendo mejor esfuerzo: un timeout esperando
  // "[yes/no]:" es un problema de temporización/sesión ya documentado
  // (ver rebootOnu()), no evidencia de que la OLT haya rechazado el ACS.
  let warning: string | undefined;
  try {
    await session.rebootOnu();
  } catch (err: any) {
    warning = `El ACS se configuró en la OLT, pero no se pudo confirmar el reinicio OMCI del ONT: ${err.message}. El cambio puede no tomar efecto hasta reiniciar manualmente.`;
    logger.warn(`[diag] updateTr069AcsUrl: rebootOnu() best-effort falló, continuando: ${warning}`);
  }

  await session.executeCommand('end');
  await session.executeCommand('write');

  return { ok: true, warning };
}
