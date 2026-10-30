import { Logger } from '@nestjs/common';
import {
  DiscoveredInterface,
  ConfigureVlanParams,
  DiscoveredInterfaceVlan,
  DiscoveredUncfgOnu,
  DiscoveredAuthorizedOnu,
  OnuOpticalPower,
} from '../ports/olt-driver.port';
import { ZteSessionLike } from './zte-telnet-session';
import { isOltErrorResponse, parseCards, parseVlanList, inferVendorFromSerial, parseOnuRunningConfig } from './zte-c320-parsers';

/**
 * Descubrimiento de interfaces físicas/VLANs y de ONUs (sin configurar o ya
 * autorizadas por fuera de Sumtech), más las acciones administrativas
 * simples sobre interfaz/ONU (shutdown, borrar registro) -- extraído de
 * `zte-c320.driver.ts` (Fase 7 de Plan_Implementacion_Refactor_ZteC320Driver.md).
 * Cada función recibe una sesión YA conectada; el ciclo de vida
 * create/connect/close se queda en los métodos delgados de `ZteC320Driver`.
 */

/**
 * Descubre las interfaces activas (show card + show interface gpon-olt_1/X/Y).
 */
export async function discoverInterfacesWithSession(session: ZteSessionLike, logger: Logger): Promise<DiscoveredInterface[]> {
  const cardOutput = await session.executeCommand('show card');
  const interfaces: DiscoveredInterface[] = [];

  // Detectar slots GPON/EPON reusando el MISMO parser ya verificado que
  // usa getCards()/getSystemHealth() (parseCards()). Este método tenía su
  // propia regex ad-hoc que desalineaba las 3 columnas numéricas
  // iniciales de "show card" (Rack/Shelf/Slot) -- confundía Shelf con
  // Slot y RealType con Status, así que NUNCA reconocía una tarjeta real
  // como "INSERVICE" y siempre caía al fallback hardcodeado (slot 1,
  // GTGO, 8 puertos) -- bug real confirmado en vivo contra OLT_Tabara_Abajo
  // (tarjeta GPON real: slot 2, tipo GTGH, 16 puertos; "0 puertos
  // detectados" en el escaneo). El número de puertos tampoco se adivina
  // más: se usa `portCount` real de la tabla, no una tabla fija GTGO=8/resto=16.
  const cards = parseCards(cardOutput);
  const gponSlots: Array<{ slot: number; cardType: string; ports: number }> = [];

  for (const card of cards) {
    if (card.status.toUpperCase() !== 'INSERVICE') continue;
    const cardType = card.cardType.toUpperCase();
    if (cardType.startsWith('GTG') || cardType.startsWith('GFG')) {
      gponSlots.push({ slot: card.slot, cardType, ports: card.portCount });
    }
  }

  // Último recurso real (equipo simulado/sin tarjetas detectables) -- no
  // debería dispararse nunca contra un chasis real con parseCards() ya
  // funcionando correctamente.
  if (gponSlots.length === 0) {
    logger.warn('No se detectó ninguna tarjeta GPON/EPON "INSERVICE" en "show card" -- usando slot 1/GTGO/8 puertos como último recurso.');
    gponSlots.push({ slot: 1, cardType: 'GTGO', ports: 8 });
  }

  // Escanear puertos GPON
  for (const { slot, ports } of gponSlots) {
    for (let port = 1; port <= ports; port++) {
      const ifaceName = `gpon-olt_1/${slot}/${port}`;
      try {
        const ifaceOut = await session.executeCommand(`show interface ${ifaceName}`, 15000);
        if (ifaceOut.includes('Invalid') || !ifaceOut.includes('gpon-olt')) {
          continue;
        }

        const adminState = ifaceOut.includes('administratively down') ? 'DOWN' : 'UP';
        const operState = ifaceOut.includes('line protocol is down') ? 'DOWN' : 'UP';

        const onusMatch = ifaceOut.match(/registered onus is (\d+)/i);
        const registeredOnus = onusMatch ? parseInt(onusMatch[1], 10) : 0;

        const inMatch = ifaceOut.match(/Input rate\s*:\s*(\d+)\s*Bps/i);
        const outMatch = ifaceOut.match(/Output rate\s*:\s*(\d+)\s*Bps/i);

        interfaces.push({
          name: ifaceName,
          type: 'PON',
          slot,
          port,
          adminState,
          operState,
          registeredOnus,
          inputBps: inMatch ? parseInt(inMatch[1], 10) : 0,
          outputBps: outMatch ? parseInt(outMatch[1], 10) : 0,
        });
      } catch (err: any) {
        logger.warn(`Error inspeccionando ${ifaceName}: ${err.message}`);
      }
    }
  }

  // Descubrir uplinks GEI reales -- antes era hardcodeado (slot 3 fijo,
  // 4 puertos fijos, estado "UP" inventado sin consultar nada). Bug real
  // confirmado en vivo contra OLT_Tabara_Abajo: "show interface ?" en ese
  // equipo nunca lista "gei_1/3" (la tarjeta PRAM de ese slot no expone
  // interfaces GEI) -- el uplink real es "gei_1/4/1" (tarjeta SMXA, con
  // tráfico real) y el rango de puertos es el portCount real de esa
  // tarjeta en "show card" (3 en este equipo), no un 4 fijo. Se recorren
  // las tarjetas EN SERVICIO que no sean GPON/EPON (esas ya se cubrieron
  // arriba) y se consulta cada puerto real; si el comando devuelve un
  // error del equipo ("%Error <código>: ..."), ese puerto no existe y se
  // omite sin inventar nada.
  for (const card of cards) {
    if (card.status.toUpperCase() !== 'INSERVICE') continue;
    const cardType = card.cardType.toUpperCase();
    if (cardType.startsWith('GTG') || cardType.startsWith('GFG')) continue;

    for (let port = 1; port <= card.portCount; port++) {
      const ifaceName = `gei_1/${card.slot}/${port}`;
      try {
        const ifaceOut = await session.executeCommand(`show interface ${ifaceName}`, 15000);
        if (isOltErrorResponse(ifaceOut) || !ifaceOut.includes(ifaceName)) {
          continue;
        }

        const adminState = new RegExp(`${ifaceName}\\s+is\\s+up`, 'i').test(ifaceOut) ? 'UP' : 'DOWN';
        const operState = /line protocol is\s+up/i.test(ifaceOut) ? 'UP' : 'DOWN';

        const inMatch = ifaceOut.match(/input rate\s*:\s*(\d+)\s*Bps/i);
        const outMatch = ifaceOut.match(/output rate\s*:\s*(\d+)\s*Bps/i);

        interfaces.push({
          name: ifaceName,
          type: 'UPLINK',
          slot: card.slot,
          port,
          adminState,
          operState,
          inputBps: inMatch ? parseInt(inMatch[1], 10) : undefined,
          outputBps: outMatch ? parseInt(outMatch[1], 10) : undefined,
        });
      } catch (err: any) {
        logger.warn(`Error inspeccionando uplink ${ifaceName}: ${err.message}`);
      }
    }
  }

  return interfaces;
}

/**
 * Configura una VLAN en una interfaz física (ej: Uplink GEI) con modo TAG (RF-OLT-012).
 */
export async function configureVlanOnInterfaceWithSession(session: ZteSessionLike, config: ConfigureVlanParams): Promise<void> {
  // 1. Entrar en modo de configuración
  await session.executeCommand('configure terminal');

  // 2. Garantizar que la VLAN exista en la OLT
  await session.executeCommand(`vlan ${config.vlanId}`);
  await session.executeCommand('exit');

  // 3. Entrar a la interfaz y aplicar VLAN
  await session.executeCommand(`interface ${config.interfaceName}`);
  if (config.mode === 'TAG') {
    await session.executeCommand(`switchport vlan ${config.vlanId} tag`);
  } else {
    await session.executeCommand(`switchport vlan ${config.vlanId} untag`);
  }
  await session.executeCommand('exit');

  // 4. Guardar cambios en memoria NVRAM
  await session.executeCommand('write');
}

/**
 * VLANs REALES (tag/untag) ya configuradas en una interfaz física, vía
 * "show vlan port <interfaz>" -- confirmado en vivo contra OLT_Tabara_Abajo
 * en los puertos uplink (gei_1/4/1) y PON (gpon-olt_1/2/1, siempre vacío
 * ahí porque el modo access de los puertos PON maneja VLANs por
 * service-port, no por este mecanismo de trunk). Ver `vlanDiscovery` en
 * OltDriverCapabilities.
 */
export async function getVlanConfigForInterfaceWithSession(
  session: ZteSessionLike,
  interfaceName: string,
): Promise<DiscoveredInterfaceVlan[]> {
  const output = await session.executeCommand(`show vlan port ${interfaceName}`);

  if (isOltErrorResponse(output)) {
    throw new Error(`La OLT rechazó la interfaz "${interfaceName}": ${output.trim()}`);
  }

  // Ancladas a inicio de línea (^ con /m): "UntaggedVlan:" contiene
  // literalmente la subcadena "TaggedVlan:" (Un+TaggedVlan:), así que un
  // regex sin anclar hace match ahí primero por error y nunca llega a la
  // línea real "TaggedVlan:" -- confirmado con el fixture real, donde
  // esto hacía desaparecer la primera VLAN de la lista en silencio.
  // Además captura "hasta el final" (no solo la primera línea): una
  // lista larga puede envolverse en varias líneas de la terminal sin
  // marcador de continuación -- parseVlanList() no se confunde con
  // saltos de línea embebidos (split(',') + trim por token).
  const untaggedMatch = output.match(/^UntaggedVlan:[ \t]*([\s\S]*?)^[ \t]*TaggedVlan:/im);
  const taggedMatch = output.match(/^TaggedVlan:[ \t]*([\s\S]*)$/im);

  const untagged = untaggedMatch ? parseVlanList(untaggedMatch[1]) : [];
  const tagged = taggedMatch ? parseVlanList(taggedMatch[1]) : [];

  const result: DiscoveredInterfaceVlan[] = [];
  for (const vlanId of untagged) result.push({ vlanId, mode: 'UNTAG' });
  for (const vlanId of tagged) result.push({ vlanId, mode: 'TAG' });
  return result;
}

/**
 * Obtiene la lista de ONUs no autorizadas descubiertas (RF-OLT-014).
 * Ejecuta `show gpon onu uncfg [ponInterface]`.
 */
export async function getUnconfiguredOnusWithSession(session: ZteSessionLike, ponInterface?: string): Promise<DiscoveredUncfgOnu[]> {
  const cmd = ponInterface ? `show gpon onu uncfg ${ponInterface}` : 'show gpon onu uncfg';
  const output = await session.executeCommand(cmd);

  const results: DiscoveredUncfgOnu[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Coincide con formato: "gpon-onu_1/1/1:1       ZTEGC0123456"
    const match = trimmed.match(/^(gpon-onu_(\d+\/\d+\/\d+):(\d+))\s+([A-Za-z0-9]+)/i);
    if (match) {
      const onuIndex = match[1];
      const ponIface = `gpon-olt_${match[2]}`;
      const serialNumber = match[4];

      results.push({
        ponInterface: ponIface,
        onuIndex,
        serialNumber,
        vendor: inferVendorFromSerial(serialNumber),
      });
    }
  }

  return results;
}

/*

revisar este bloque de condigo y su efecto en el sistema

*/
/**
 * Importación pasiva de ONUs ya autorizadas/aprovisionadas en un puerto PON
 * (RF: incorporar un sitio con clientes en producción de otro sistema sin
 * re-emitir el CLI de autorización). Comandos confirmados en vivo contra
 * OLT_Tabara_Abajo (2026-10-17):
 * - "show gpon onu baseinfo <puerto>" -- UNA sola consulta por puerto,
 *   trae el serial real de TODAS las ONUs del puerto ("AuthInfo: SN:...").
 *   El tipo/modelo puede partirse en una segunda línea si el nombre es
 *   largo (ej. "HUAWEY-BT54\n  6XG") -- no afecta el parseo porque cada
 *   fila real empieza con el índice completo "gpon-onu_...".
 * - "show gpon onu state <puerto>" -- estado admin/fase real por ONU
 *   (columna 1 sin el prefijo "gpon-onu_", ej. "1/2/1:1").
 * Deliberadamente NO se usa "show onu running config" aquí: en este equipo
 * real esas ONUs están gestionadas por OMCI puro (bloque "pon-onu-mng"),
 * que no incluye serial ni VLAN de servicio en un formato parseable sin
 * inventar -- el serial ya viene de "baseinfo", y VLAN/perfil quedan para
 * que el operador los configure al vincular la ONU a un contrato.
 */
export async function getAuthorizedOnusWithSession(
  session: ZteSessionLike,
  ponInterface: string,
  logger: Logger,
): Promise<DiscoveredAuthorizedOnu[]> {
  // Timeout muy generoso (bug real confirmado en producción, 2026-10-17,
  // OLT_Tabara_Abajo): en una conexión aislada este comando tarda 1-2s
  // incluso con varias páginas "--More--" (confirmado contra puertos con
  // 50+ ONUs). Los timeouts reales en producción coincidieron con las
  // ventanas de los cron de monitoreo (cada 5 min, sondean la misma OLT)
  // -- probable contención del event loop de Node, no lentitud real del
  // equipo ni de la paginación. Es una acción deliberada del operador
  // (importar un puerto puntual), no un sondeo frecuente, así que se
  // tolera bastante margen en vez de intentar resolver la contención aquí.
  const baseInfoOutput = await session.executeCommand(`show gpon onu baseinfo ${ponInterface}`, 180000);
  if (isOltErrorResponse(baseInfoOutput)) {
    throw new Error(`La OLT no reconoce el puerto PON "${ponInterface}".`);
  }

  const baseRows = new Map<string, { onuType: string; serialNumber: string }>();
  const baseMatches = baseInfoOutput.matchAll(/^(gpon-onu_\d+\/\d+\/\d+:\d+)\s+(\S+)\s+sn\s+SN:(\S+)/gim);
  for (const m of baseMatches) {
    baseRows.set(m[1], { onuType: m[2], serialNumber: m[3] });
  }

  const stateRows = new Map<string, { adminState: 'ENABLE' | 'DISABLE'; phaseState: string }>();
  try {
    const stateOutput = await session.executeCommand(`show gpon onu state ${ponInterface}`, 180000);
    const stateMatches = stateOutput.matchAll(/^(\d+\/\d+\/\d+:\d+)\s+(enable|disable)\s+\S+\s+(\S+)/gim);
    for (const m of stateMatches) {
      stateRows.set(`gpon-onu_${m[1]}`, {
        adminState: m[2].toUpperCase() as 'ENABLE' | 'DISABLE',
        phaseState: m[3],
      });
    }
  } catch (err: any) {
    logger.warn(`No se pudo leer "show gpon onu state ${ponInterface}": ${err.message}`);
  }

  const discovered: DiscoveredAuthorizedOnu[] = [];
  for (const [onuIndex, base] of baseRows) {
    const state = stateRows.get(onuIndex);
    discovered.push({
      ponInterface,
      onuIndex,
      serialNumber: base.serialNumber,
      vendor: inferVendorFromSerial(base.serialNumber),
      onuType: base.onuType,
      adminState: state?.adminState || 'ENABLE',
      phaseState: state?.phaseState,
    });
  }

  return discovered;
}

/**
 * Consulta la configuración activa de una sub-interfaz de ONU (ej. gpon-onu_1/2/15:1)
 * para extraer name (cliente) y description (zona/fecha) directamente de la OLT.
 */
export async function getOnuRunningConfigWithSession(
  session: ZteSessionLike,
  onuInterface: string,
): Promise<{ name?: string; description?: string; raw?: string }> {
  const output = await session.executeCommand(`show running-config interface ${onuInterface}`, 15000);
  const parsed = parseOnuRunningConfig(output);
  return { ...parsed, raw: output };
}

/**
 * Consulta los niveles de potencia óptica RX/TX de una ONU (RF-OLT-015).
 * Ejecuta `show pon power attenuation gpon-onu_X:Y`.
 */
export async function getOnuOpticalPowerWithSession(session: ZteSessionLike, onuTarget: string): Promise<OnuOpticalPower> {
  const output = await session.executeCommand(`show pon power attenuation ${onuTarget}`);

  // Parser para ZTE C320 -- CORREGIDO 2026-10-23 tras comparar contra la
  // salida real del equipo de laboratorio (el formato documentado/asumido
  // antes no coincidía y dejaba rxDbm/txDbm/attenuationDb SIEMPRE
  // undefined, para CUALQUIER ONU, no solo una puntual):
  //   OLT                  ONU              Attenuation
  //   up      Rx :-13.404(dbm)      Tx:1.376(dbm)        14.780(dB)
  //   down    Tx :6.719(dbm)        Rx:-21.250(dbm)      27.969(dB)
  // Dos diferencias clave frente al parser anterior:
  // 1) El orden de "Rx"/"Tx" DENTRO de la línea cambia según la fila
  //    ("up" trae Rx primero, "down" trae Tx primero) -- el regex viejo
  //    asumía "Rx" siempre inmediatamente después de "down"/"up".
  // 2) No existe la palabra literal "attenuation:" -- es un número suelto
  //    en "(dB)" al final de cada línea, una atenuación POR DIRECCIÓN.
  // Por eso ahora se busca Rx/Tx dentro de cada línea sin asumir orden, y
  // se toma el "(dB)" final de esa misma línea como su atenuación.
  const lines = output.split(/\r?\n/);
  const downLine = lines.find((l) => /^\s*down\b/i.test(l));
  const upLine = lines.find((l) => /^\s*up\b/i.test(l));

  const parseDirLine = (line?: string) => {
    if (!line) return { rx: undefined, tx: undefined, attenuation: undefined };
    const rxMatch = line.match(/Rx\s*:\s*([-\d.]+)\s*\(dbm\)/i);
    const txMatch = line.match(/Tx\s*:\s*([-\d.]+)\s*\(dbm\)/i);
    const attMatch = line.match(/([-\d.]+)\s*\(dB\)\s*$/i);
    return {
      rx: rxMatch ? parseFloat(rxMatch[1]) : undefined,
      tx: txMatch ? parseFloat(txMatch[1]) : undefined,
      attenuation: attMatch ? parseFloat(attMatch[1]) : undefined,
    };
  };

  // "down Rx" = potencia que la ONU RECIBE de la OLT (Potencia RX (ONU)).
  // "up Tx"   = potencia que la ONU EMITE con su propio láser.
  // La atenuación real OLT->ONU es la de la fila "down" (Tx del OLT vs
  // Rx de la ONU); la de "up" es la del tramo inverso.
  const down = parseDirLine(downLine);
  const up = parseDirLine(upLine);

  return {
    rxDbm: down.rx,
    txDbm: up.tx,
    downRxDbm: down.rx,
    upRxDbm: up.rx,
    attenuationDb: down.attenuation,
    raw: output.slice(0, 300),
  };
}

/**
 * Bloquea o reactiva una ONU en la OLT mediante shutdown / no shutdown (RF-OLT-017).
 */
export async function setOnuAdminStateWithSession(session: ZteSessionLike, onuTarget: string, state: 'ACTIVE' | 'BLOCKED'): Promise<void> {
  await session.executeCommand('configure terminal');
  await session.executeCommand(`interface ${onuTarget}`);
  if (state === 'BLOCKED') {
    await session.executeCommand('shutdown');
  } else {
    await session.executeCommand('no shutdown');
  }
  await session.executeCommand('exit');
  await session.executeCommand('write');
}

/**
 * Elimina el registro de una ONU en la OLT (RF-OLT-016 desautorización).
 */
export async function deleteOnuWithSession(session: ZteSessionLike, ponInterface: string, onuId: number): Promise<void> {
  await session.executeCommand('configure terminal');
  await session.executeCommand(`interface ${ponInterface}`);
  await session.executeCommand(`no onu ${onuId}`);
  await session.executeCommand('exit');
  await session.executeCommand('write');
}

/**
 * "shutdown"/"no shutdown" sobre la interfaz indicada — mismo mecanismo ya
 * confirmado en producción vía `setOnuAdminStateWithSession()`, aplicado
 * aquí a una interfaz física completa (puerto PON o uplink) en vez de a la
 * sub-interfaz virtual de un ONU individual. Apagar un puerto PON corta a
 * TODOS los ONUs de ese puerto, no a uno solo.
 */
export async function setInterfaceAdminStateWithSession(session: ZteSessionLike, interfaceName: string, state: 'UP' | 'DOWN'): Promise<void> {
  await session.executeCommand('configure terminal');
  await session.executeCommand(`interface ${interfaceName}`);
  if (state === 'DOWN') {
    await session.executeCommand('shutdown');
  } else {
    await session.executeCommand('no shutdown');
  }
  await session.executeCommand('exit');
  await session.executeCommand('write');
}

export async function getInterfaceTrafficWithSession(
  session: ZteSessionLike,
  interfaceName: string,
): Promise<{ rxKbps: number; txKbps: number; rawBps?: { inputBps: number; outputBps: number } }> {
  const ifaceOut = await session.executeCommand(`show interface ${interfaceName}`, 15000);
  const inMatch = ifaceOut.match(/Input rate\s*:\s*(\d+)\s*Bps/i);
  const outMatch = ifaceOut.match(/Output rate\s*:\s*(\d+)\s*Bps/i);
  const inBps = inMatch ? parseInt(inMatch[1], 10) : 0;
  const outBps = outMatch ? parseInt(outMatch[1], 10) : 0;
  return {
    rxKbps: Math.round((inBps * 8) / 1000),
    txKbps: Math.round((outBps * 8) / 1000),
    rawBps: { inputBps: inBps, outputBps: outBps },
  };
}
