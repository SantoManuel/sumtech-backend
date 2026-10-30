import { Logger } from '@nestjs/common';
import { TcontProfile, TrafficProfile, OnuTypeProfile, DiscoveredTcontProfile, DiscoveredTrafficProfile } from '../ports/olt-driver.port';
import { ZteSessionLike } from './zte-telnet-session';
import { isOltErrorResponse, parseTcontProfilesFromOutput, parseTrafficProfilesFromOutput } from './zte-c320-parsers';

/**
 * Gestión de perfiles TCONT / Traffic / onu-type -- extraída de
 * `zte-c320.driver.ts` (Fase 6 de Plan_Implementacion_Refactor_ZteC320Driver.md).
 * Cada función recibe una sesión YA conectada; el ciclo de vida
 * create/connect/close se queda en los métodos delgados de `ZteC320Driver`.
 */

/**
 * Busca un perfil TCONT por nombre vía `show gpon profile tcont`.
 * Reutiliza el mismo parser que `getTcontProfiles()` (confirmado en vivo
 * contra OLT_Tabara_Abajo, 2026-10-19) en vez del viejo heurístico
 * "busca la palabra 'fixed' cerca del nombre", que nunca coincidía con el
 * formato real (columnas Type/FBW/ABW/MBW, sin la palabra "fixed" en
 * ningún lado de la salida de `show`).
 */
export async function findTcontProfileByNameWithSession(session: ZteSessionLike, name: string): Promise<TcontProfile | null> {
  const output = await session.executeCommand('show gpon profile tcont');
  const found = parseTcontProfilesFromOutput(output).find((p) => p.name === name);
  return found ? { name: found.name, fixedKbps: found.speedKbps } : null;
}

/**
 * Crea el perfil TCONT tipo 5 (Fixed + Assured + Maximum) si no existe --
 * CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-19) con un perfil de
 * prueba ("SUMTECH-TEST-DELETE-ME"), creado y eliminado limpiamente:
 *   configure terminal / gpon / profile tcont <nombre> type 5 fixed 64
 *   assured 64 maximum <kbps> / exit / exit / write
 * FBW=64 y ABW=64 replican exactamente la convención real que usan los
 * ~40 perfiles "SMARTOLT-*-UP" ya configurados en esta OLT (ver
 * `getTcontProfiles`) -- no son valores inventados.
 *
 * IMPORTANTE — alcance: TCONT en GPON gobierna el ancho de banda de
 * SUBIDA del ONU únicamente (ITU-T G.984). El ancho de banda de BAJADA
 * se gestiona con un mecanismo aparte -- ver `ensureTrafficProfileWithSession`,
 * que sí lo cubre usando `net.olt_speed_profiles.vendor_traffic_profile`.
 * No asumir que crear el TCONT ya configuró la velocidad completa del
 * cliente en ambos sentidos: para eso hacen falta AMBOS métodos.
 */
export async function ensureTcontProfileWithSession(session: ZteSessionLike, profile: TcontProfile): Promise<void> {
  const output = await session.executeCommand('show gpon profile tcont');
  const existing = parseTcontProfilesFromOutput(output).find((p) => p.name === profile.name);
  if (existing) {
    return;
  }
  await session.executeCommand('configure terminal');
  await session.executeCommand('gpon');
  const createOutput = await session.executeCommand(
    `profile tcont ${profile.name} type 5 fixed 64 assured 64 maximum ${profile.fixedKbps}`,
  );
  if (isOltErrorResponse(createOutput)) {
    throw new Error(`La OLT rechazó el perfil TCONT "${profile.name}": ${createOutput.trim()}`);
  }
  await session.executeCommand('exit');
  await session.executeCommand('exit');
  await session.executeCommand('write');
}

/**
 * Crea (o comprueba) el traffic-profile de BAJADA (CIR=PIR=downKbps) --
 * CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-19/2026-10-27):
 *   "show traffic-profile" lista los perfiles existentes sin entrar a config.
 * Si el perfil ya existe, retorna inmediatamente sin mandar comandos innecesarios
 * a la OLT ni escribir a la flash (write).
 * Si no existe, lo crea con:
 *   configure terminal / traffic-profile <nombre> ip cir <kbps> cbs 1000
 *   pir <kbps> pbs 1000 / exit / write
 */
export async function ensureTrafficProfileWithSession(session: ZteSessionLike, profile: TrafficProfile): Promise<void> {
  const listOutput = await session.executeCommand('show traffic-profile');
  const existing = parseTrafficProfilesFromOutput(listOutput).find((p) => p.name === profile.name);
  if (existing) {
    return;
  }

  await session.executeCommand('configure terminal');
  const createOutput = await session.executeCommand(
    `traffic-profile ${profile.name} ip cir ${profile.downKbps} cbs 1000 pir ${profile.downKbps} pbs 1000`,
  );
  if (isOltErrorResponse(createOutput)) {
    // Salir de "(config)#" antes de lanzar
    try {
      await session.executeCommand('exit');
    } catch {
      /* best-effort */
    }
    throw new Error(`La OLT rechazó el traffic-profile "${profile.name}": ${createOutput.trim()}`);
  }
  await session.executeCommand('exit');
  await session.executeCommand('write');
}

/**
 * Asegura que el "onu-type" (perfil de capacidades OMCI que exige
 * `onu <id> type <nombre> sn <serial>`) exista en la OLT antes de
 * autorizar -- sin esto, la OLT rechaza con "%Code 63904-GPONRM : Not
 * support this ONU." cualquier modelo que nunca se haya registrado antes
 * a mano por Telnet. Los límites OMCI (max-tcont 8, max-gemport 32,
 * max-switch-perslot 8, max-flow-perswitch 8) reutilizan los mismos
 * valores genéricos que ya traen los 2 perfiles Huawei reales preexistentes
 * en OLT_Tabara_Abajo (HUAWEY-HG8145V5, HUAWEY-BT546XG) -- no hay forma de
 * descubrir los límites OMCI reales de un modelo sin su datasheet.
 *
 * CONFIRMADO CONTRA EL MANUAL OFICIAL (ZXA10 C300 Configuration Manual
 * (CLI), §2.1, SJ-20130520164529-007): el flujo "configure terminal" /
 * "pon" / "onu-type <nombre> gpon description <desc> max-tcont <n>
 * max-gemport <n> max-switch-perslot <n> max-flow-perswitch <n>" /
 * "onu-type-if <nombre> eth_0/1-<N>" / "onu-type-if <nombre> pots_0/1-<N>"
 * es correcto -- PERO el primer intento en vivo contra OLT_Tabara_Abajo
 * (2026-10-19) falló con "%Error 20201: Invalid input detected ... Invalid
 * command key word" porque `description` se mandaba entre comillas con
 * espacios (`"Auto-creado por Sumtech"`). El manual (ejemplo real:
 * "description 4ETH,2POTS") deja claro que NO es una cadena libre, sino
 * un solo token SIN espacios ni comillas -- por eso ahora se genera como
 * "<ethPorts>ETH,<potsPorts>POTS", replicando la misma convención que usa
 * el propio fabricante en sus tipos nativos (ZTEG-F620, etc.).
 *
 * "max-veip 1" agregado (2026-10-22) -- sin esto el onu-type queda con
 * "Max VEIP: 0" (keyword real, confirmado vía ayuda contextual de la OLT),
 * lo que bloquea a nivel OMCI el bloque TR-069 de
 * `generateTr069ManagementScript` para CUALQUIER ONU que use un onu-type
 * creado por este método. Se aplica tanto a onu-types NUEVOS (en la
 * creación) como a onu-types que YA EXISTÍAN de antes con "Max VEIP: 0"
 * (ej. HUAWEY-HG8145V5 en OLT_Tabara_Abajo) -- ver el chequeo de
 * `alreadyExists` más abajo, que ahora repara ese campo en caliente en vez
 * de salir sin tocar nada.
 */
export async function ensureOnuTypeProfileWithSession(session: ZteSessionLike, profile: OnuTypeProfile, logger: Logger): Promise<void> {
  const checkOutput = await session.executeCommand(`show onu-type gpon ${profile.name}`);
  const alreadyExists = !isOltErrorResponse(checkOutput) && checkOutput.includes(profile.name);
  if (alreadyExists) {
    // CONFIRMADO EN VIVO (2026-10-22) contra OLT_Tabara_Abajo: un onu-type
    // PREEXISTENTE (creado antes de que este método supiera de "max-veip",
    // ej. HUAWEY-HG8145V5) puede quedar con "Max VEIP: 0" -- esto bloquea a
    // nivel OMCI el comando "veip 1 port udp 1232 host 2" del bloque TR-069
    // con "%Code 63990-GPONRM : ONT return error: command processing
    // error.", sin importar cuántas veces se reautorice la ONU, porque
    // antes este método se salía aquí sin tocar un onu-type ya existente.
    // "show onu-type gpon <nombre>" reporta "Max VEIP:   0(default: 1
    // VEIP)" -- se repara en caliente con "onu-type <nombre> gpon max-veip
    // 1". Según la gramática real de este comando (confirmada vía ayuda
    // contextual: todos los parámetros de "onu-type <nombre> gpon ..." son
    // opcionales e independientes entre sí), esto debería actualizar SOLO
    // "max-veip" sin tocar el resto -- AÚN NO reconfirmado en vivo (el
    // sandbox bloqueó el intento de probarlo manualmente), así que sigue
    // sin ser 100% seguro hasta la próxima autorización real.
    //
    // MEJOR ESFUERZO, nunca debe tumbar la autorización -- CONFIRMADO EN
    // VIVO (2026-10-22) que la OLT puede rechazar esta corrección con
    // "%Code 70296 : Profile is being used." cuando el onu-type ya tiene
    // OTRAS ONUs reales asignadas (caso normal: un modelo común como
    // HUAWEY-HG8145V5 suele ser compartido por varias ONUs en la misma
    // OLT) -- un primer intento de este fix lo trataba como error duro y
    // tumbaba la autorización óptica completa, rompiendo algo que antes
    // funcionaba. Si la corrección falla, se registra un warning y se
    // sigue -- el TR-069 de la Etapa 2 seguirá fallando para este
    // onu-type hasta que se libere (ningún ONU usándolo) o se corrija a
    // mano, pero eso nunca debe bloquear que el cliente quede con internet
    // (Etapa 1).
    const maxVeipMatch = checkOutput.match(/Max VEIP:\s*(\d+)/i);
    const maxVeip = maxVeipMatch ? parseInt(maxVeipMatch[1], 10) : undefined;
    if (maxVeip !== undefined && maxVeip < 1) {
      let fixSucceeded = false;
      try {
        await session.executeCommand('configure terminal');
        await session.executeCommand('pon');
        const fixOutput = await session.executeCommand(`onu-type ${profile.name} gpon max-veip 1`);
        if (isOltErrorResponse(fixOutput)) {
          logger.warn(
            `[diag] ensureOnuTypeProfileWithSession: no se pudo corregir "max-veip" del onu-type "${profile.name}" (mejor esfuerzo, no bloquea la autorización): ${fixOutput.trim()}`,
          );
        } else {
          fixSucceeded = true;
        }
      } catch (err: any) {
        // De verdad "mejor esfuerzo": antes, una excepción acá (timeout,
        // socket cerrado) se propagaba sin ningún catch y abortaba TODA la
        // autorización óptica, contradiciendo este mismo comentario (bug
        // real confirmado por revisión de código, 2026-10-23).
        logger.warn(
          `[diag] ensureOnuTypeProfileWithSession: excepción corrigiendo "max-veip" del onu-type "${profile.name}" (mejor esfuerzo, no bloquea la autorización): ${err.message}`,
        );
      } finally {
        // "write" EXIGE estar en el prompt top-level "#" (mismo criterio
        // que el resto de este archivo) -- nunca dentro de "configure
        // terminal"/"pon", por eso corre DESPUÉS de los dos "exit", no antes.
        // Cada "exit" también es best-effort: si el socket ya quedó en mal
        // estado por la excepción de arriba, no debe enmascararla ni
        // lanzar una nueva.
        try {
          await session.executeCommand('exit');
        } catch {
          /* best-effort */
        }
        try {
          await session.executeCommand('exit');
        } catch {
          /* best-effort */
        }
      }
      if (fixSucceeded) {
        try {
          await session.executeCommand('write');
        } catch (err: any) {
          logger.warn(
            `[diag] ensureOnuTypeProfileWithSession: no se pudo guardar "write" tras corregir max-veip (mejor esfuerzo): ${err.message}`,
          );
        }
      }
    }
    return;
  }

  await session.executeCommand('configure terminal');
  await session.executeCommand('pon');
  const description = `${profile.ethPorts ?? 0}ETH,${profile.potsPorts ?? 0}POTS`;
  // "max-veip 1" -- CONFIRMADO EN VIVO (2026-10-22) contra OLT_Tabara_Abajo:
  // sin este parámetro, el onu-type queda con "Max VEIP: 0" (confirmado vía
  // "show onu-type gpon <nombre>"), lo que hace que el ONT rechace a nivel
  // OMCI el comando "veip 1 port udp 1232 host 2" del bloque TR-069
  // (generateTr069ManagementScript) con "%Code 63990-GPONRM : ONT return
  // error: command processing error." -- la Etapa 2 del flujo de 3 etapas
  // (applyTr069Profile) nunca llega a apuntar el ONT al ACS para ningún
  // onu-type creado por este método. "max-veip" confirmado como keyword
  // real vía ayuda contextual ("onu-type <nombre> gpon ... ?").
  const createOutput = await session.executeCommand(
    `onu-type ${profile.name} gpon description ${description} max-tcont 8 max-gemport 32 max-switch-perslot 8 max-flow-perswitch 8 max-veip 1`,
  );
  if (isOltErrorResponse(createOutput)) {
    await session.executeCommand('exit');
    await session.executeCommand('exit');
    throw new Error(`La OLT rechazó el onu-type "${profile.name}": ${createOutput.trim()}`);
  }

  if (profile.ethPorts && profile.ethPorts > 0) {
    const ethOutput = await session.executeCommand(`onu-type-if ${profile.name} eth_0/1-${profile.ethPorts}`);
    if (isOltErrorResponse(ethOutput)) {
      await session.executeCommand('exit');
      await session.executeCommand('exit');
      throw new Error(`La OLT rechazó los puertos ETH del onu-type "${profile.name}": ${ethOutput.trim()}`);
    }
  }
  if (profile.potsPorts && profile.potsPorts > 0) {
    const potsOutput = await session.executeCommand(`onu-type-if ${profile.name} pots_0/1-${profile.potsPorts}`);
    if (isOltErrorResponse(potsOutput)) {
      await session.executeCommand('exit');
      await session.executeCommand('exit');
      throw new Error(`La OLT rechazó los puertos POTS del onu-type "${profile.name}": ${potsOutput.trim()}`);
    }
  }

  await session.executeCommand('exit');
  await session.executeCommand('exit');
  await session.executeCommand('write');
}
