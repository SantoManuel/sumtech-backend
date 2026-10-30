import { DiscoveredCard, DiscoveredTcontProfile, DiscoveredTrafficProfile, OnuDetailInfo } from '../ports/olt-driver.port';

/**
 * Funciones puras de parseo/clasificación de texto del driver ZTE C320 --
 * extraídas de `zte-c320.driver.ts` (Fase 2 de
 * Plan_Implementacion_Refactor_ZteC320Driver.md). Ninguna usa `this` ni
 * estado de sesión: reciben el texto crudo de la OLT y devuelven datos
 * estructurados. Movidas tal cual, sin cambios de comportamiento.
 */

/**
 * Detecta si la OLT rechazó un comando -- CONFIRMADO EN VIVO contra
 * OLT_Tabara_Abajo (2026-10-19) que existen DOS formatos de error
 * distintos en este firmware, no uno:
 *   "%Error <código>: <mensaje>"           (ej. interfaz/puerto inexistente)
 *   "%Code <código>-<MÓDULO> : <mensaje>"  (ej. "%Code 63904-GPONRM : Not
 *                                           support this ONU." -- un Tipo
 *                                           de ONU inválido en
 *                                           "onu <id> type <X> sn <Y>";
 *                                           también "%Code 10: Invalid
 *                                           parameter!" por un serial con
 *                                           formato inválido)
 * `authorizeOnu()` nunca revisaba ninguno de los dos antes de este fix:
 * una autorización rechazada por la OLT (ej. por un Tipo de ONU
 * placeholder como "Generico", que no existe como perfil real en la OLT)
 * se reportaba como éxito sin haber escrito nada de verdad.
 */
export function isOltErrorResponse(output: string): boolean {
  return /%Error\b/i.test(output) || /%Code\s+\d+(-\w+)?\s*:/i.test(output);
}

/**
 * Detecta el idioma recurrente de este firmware para "este paso del script
 * ya se aplicó en un intento anterior" -- NO es un rechazo real. Confirmado
 * en vivo contra OLT_Tabara_Abajo (2026-10-20) con DOS mensajes distintos,
 * mismo significado:
 *   "%Code 62391-GPONSRV : The entry is existed. This is a re-create
 *   operation." (en "onu <id> type ... sn ...")
 *   "%Code 66661: The service is already existed." (en
 *   "service-port 1 vport 1 user-vlan ... vlan ...")
 *   "%Code 63869-GPONRM : Record already exists." (en "flow <n> switch
 *   switch_0/1" y comandos similares del bloque OMCI -- bug real
 *   confirmado en producción 2026-10-22: reintentar una autorización que ya
 *   había aplicado el cableado OMCI del canal de internet -- ver
 *   `generateAuthorizationScript` -- abortaba en el primer "flow" ya
 *   aplicado en vez de tolerarlo como los demás pasos, porque esta frase
 *   nunca estaba cubierta por el patrón de abajo, pese a ya haberse visto
 *   antes en `applyTr069Management` como advertencia).
 *   "%Code 63873-GPONRM : GEM port already exists." (en "gemport <n> flow <n>"
 *   y "gemport <n> tcont <n>" -- bug real confirmado en producción 2026-10-22:
 *   reintentar la configuración TR-069 o una autorización previa reportaba
 *   una advertencia falsa de fallo de TR-069 ("La OLT rechazó la
 *   configuración TR-069/ACS ('gemport 2 flow 2'): %Code 63873-GPONRM : GEM
 *   port already exists.") o abortaba la autorización).
 * Ambos aparecen cuando una autorización previa de la MISMA ONU falló
 * DESPUÉS de ese paso (ej. por los bugs reales de "gpon-olt_" vs
 * "gpon-onu_" y de "tr069-mgmt" ya corregidos), dejando ese paso concreto
 * ya aplicado en la OLT con el mismo valor que se está volviendo a enviar.
 * Tratar esto como fatal abortaba el resto del script (los pasos
 * siguientes nunca llegaban a aplicarse) aunque ese paso puntual ya
 * estuviera correctamente configurado. Se reconoce en CUALQUIER comando
 * del script de autorización -- `isOltErrorResponse()` sigue tratando
 * cualquier otro texto de error como rechazo real.
 */
export function isAlreadyAppliedResponse(output: string): boolean {
  return /\bis\s+(?:already\s+)?existed\b/i.test(output) || /\balready\s+exist(?:s|ed)?\b/i.test(output);
}

/**
 * Parsea el formato de uptime real de "show card slotno <N>" en este
 * equipo: "122 Days, 3 Hours, 37 Minutes, 13 Seconds" (coincide con el
 * mismo uptime reportado por "show system-group" -- confirmado en vivo).
 */
export function parseZteUptimeToSeconds(raw: string): number | undefined {
  const dayMatch = raw.match(/(\d+)\s*Days?/i);
  const hourMatch = raw.match(/(\d+)\s*Hours?/i);
  const minuteMatch = raw.match(/(\d+)\s*Minutes?/i);
  const secondMatch = raw.match(/(\d+)\s*Seconds?/i);

  if (!dayMatch && !hourMatch && !minuteMatch && !secondMatch) {
    return undefined;
  }

  const days = dayMatch ? parseInt(dayMatch[1], 10) : 0;
  const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
  const minutes = minuteMatch ? parseInt(minuteMatch[1], 10) : 0;
  const seconds = secondMatch ? parseInt(secondMatch[1], 10) : 0;

  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/**
 * Inventario real de tarjetas/slots del chasis (show card). Usa el mismo
 * comando ya verificado en test/fixtures/zte-c320/show_card.txt.
 */
export function parseCards(output: string): DiscoveredCard[] {
  const cards: DiscoveredCard[] = [];
  const rowMatches = output.matchAll(
    /^\s*\d+\s+\d+\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/gm,
  );

  for (const m of rowMatches) {
    cards.push({
      slot: parseInt(m[1], 10),
      cardType: m[2],
      realType: m[3],
      portCount: parseInt(m[4], 10),
      hardVer: m[5],
      softVer: m[6],
      status: m[7],
    });
  }

  return cards;
}

export function parseVlanList(text: string): number[] {
  const result: number[] = [];
  for (const token of text.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let v = start; v <= end && v - start < 4094; v++) {
        result.push(v);
      }
      continue;
    }
    const single = parseInt(trimmed, 10);
    if (!Number.isNaN(single)) {
      result.push(single);
    }
  }
  return result;
}

export function inferVendorFromSerial(serialNumber: string): string {
  const upperSn = serialNumber.toUpperCase();
  if (upperSn.startsWith('ZTEG')) return 'ZTE';
  if (upperSn.startsWith('HWTC')) return 'Huawei';
  if (upperSn.startsWith('VSOL')) return 'VSOL';
  if (upperSn.startsWith('ALCL')) return 'Nokia/Alcatel';
  if (upperSn.startsWith('FHTT')) return 'Fiberhome';
  return 'Desconocido';
}

export function parseOnuRunningConfig(output: string): { name?: string; description?: string } {
  if (!output || typeof output !== 'string') return {};
  const nameMatch = output.match(/^\s*name\s+(\S+)/mi);
  const descMatch = output.match(/^\s*description\s+(\S+)/mi);
  return {
    name: nameMatch ? nameMatch[1] : undefined,
    description: descMatch ? descMatch[1] : undefined,
  };
}

/**
 * Parser de "show gpon remote-onu ip-host <interfaz>" -- esta es la señal
 * REAL de si la ONU obtuvo IP de gestión para el camino de aprovisionamiento
 * que SÍ usamos hoy (ip-host + dhcp-ip ethuni) -- a diferencia de
 * `getOnuWanIp` (comando "wan-ip"), que solo aplica al mecanismo alternativo
 * de Plan_Implementacion_WanIp_VlanProfile_HGU.md, todavía no implementado.
 * Confirmado en vivo (2026-10-29, ONU ECOM0F91DF9B): "show ... wan-ip"
 * devuelve "%Code 64040-GPONRM : No relate information to show" para
 * cualquier ONU que NO pase por ese mecanismo -- no es evidencia de que la
 * ONU no tenga IP, solo de que no usa "wan-ip".
 *
 * CONFIRMADO EN VIVO (2026-10-29, ONU ECOM0F91DF9B): el firmware real usa
 * "IP addres:" (typo real del fabricante, sin la "s" final) y "Current IP
 * address:" (bien escrito) -- "Current IP address" es el valor realmente
 * negociado por DHCP (más confiable que "IP addres", que puede quedar en
 * blanco aun con DHCP activo) y se prioriza sobre el campo plano "IP:"/
 * "IP addres:" cuando ambos están presentes. El ancla de línea (^/\n) en el
 * patrón plano evita que la "IP" dentro de "Current IP address:" se cuente
 * dos veces.
 */
export function parseIpHost(raw: string): { mgmtIp?: string; ipHostFound: boolean } {
  let mgmtIp: string | undefined;
  let ipHostFound = false;

  // Buscar Host ID: 2 (gestión TR-069)
  const host2Match = raw.match(/Host\s*(?:ID)?\s*:\s*2\b([\s\S]*?)(?:Host\s*(?:ID)?\s*:\s*\d+|$)/i);
  const searchTarget = host2Match ? host2Match[1] : raw;

  if (host2Match) {
    ipHostFound = true;
  }

  const currentIpMatch = searchTarget.match(/Current\s+IP\s*(?:addr(?:ess|es))?\s*:\s*(\d{1,3}(?:\.\d{1,3}){3})/i);
  const plainIpMatch = searchTarget.match(/(?:^|\n)\s*IP\s*(?:addr(?:ess|es))?\s*:\s*(\d{1,3}(?:\.\d{1,3}){3})/im);
  const ipMatch = currentIpMatch || plainIpMatch;
  if (ipMatch) {
    const parsedIp = ipMatch[1];
    if (parsedIp !== '0.0.0.0') {
      mgmtIp = parsedIp;
    }
  }

  return { mgmtIp, ipHostFound };
}

/** Parser de "show mac gpon onu <interfaz>". */
export function parseMacTable(raw: string): Array<{ mac: string; vlan: number }> {
  const learnedMacs: Array<{ mac: string; vlan: number }> = [];
  const macRegex = /([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}|[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})\s+(?:\S+\s+)?(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = macRegex.exec(raw)) !== null) {
    learnedMacs.push({
      mac: match[1],
      vlan: parseInt(match[2], 10),
    });
  }
  return learnedMacs;
}

/** Parser de "show gpon onu detail-info <interfaz>" -- ver `OnuDetailInfo` para las notas sobre qué campos están confirmados en vivo. */
export function parseOnuDetailInfo(raw: string): OnuDetailInfo {
  return {
    type: raw.match(/^\s*Type:\s*(\S+)/im)?.[1],
    configState: raw.match(/Config state:\s*(\S+)/i)?.[1],
    onlineDuration: raw.match(/Online\s*Duration:\s*(.+)/i)?.[1]?.trim(),
    adminState: raw.match(/Admin\s*state:\s*(\S+)/i)?.[1],
    raw,
  };
}

export function parseTcontProfilesFromOutput(output: string): DiscoveredTcontProfile[] {
  // "Profile name :<nombre>" seguido (con ruido de paginación/backspace
  // posible en medio) de la fila de datos "Type FBW ABW MBW PRIORITY
  // WEIGHT" -- se salta de forma perezosa hasta la primera fila que calce
  // el patrón numérico real, sin depender del texto exacto de la cabecera
  // (que puede variar o llegar fragmentado por "--More--").
  const profileRegex = /Profile name\s*:\s*(\S+)[\s\S]*?\r?\n\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)/g;
  const results: DiscoveredTcontProfile[] = [];
  let match: RegExpExecArray | null;
  while ((match = profileRegex.exec(output)) !== null) {
    const [, name, type, fbw, abw, mbw] = match;
    const fbwKbps = parseInt(fbw, 10);
    const abwKbps = parseInt(abw, 10);
    const mbwKbps = parseInt(mbw, 10);
    results.push({
      name,
      type: parseInt(type, 10),
      fbwKbps,
      abwKbps,
      mbwKbps,
      speedKbps: Math.max(fbwKbps, abwKbps, mbwKbps),
    });
  }
  return results;
}

export function parseTrafficProfilesFromOutput(output: string): DiscoveredTrafficProfile[] {
  const regex = /No\.\s*\d+\s+profile\s*:\s*([^\r\n]+)/g;
  const profiles: DiscoveredTrafficProfile[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    const name = match[1].trim();
    if (!name) continue;
    const mbMatch = name.match(/TRAFFIC-(\d+)M/i);
    const downKbps = mbMatch ? parseInt(mbMatch[1], 10) * 1024 : undefined;
    profiles.push({ name, downKbps });
  }
  return profiles;
}
