import { OnuDetailInfo, OnuIpHostInfo, OnuWanIpInfo, OnuTr069MgmtInfo, OnuProvisioningVerification } from '../ports/olt-driver.port';
import { ZteSessionLike } from './zte-telnet-session';
import { toOnuInterfaceName } from './zte-c320-provisioning-scripts';
import { parseIpHost, parseMacTable, parseOnuDetailInfo } from './zte-c320-parsers';

/**
 * Lógica de la pestaña de Auditoría de Aprovisionamiento (`show gpon onu
 * detail-info` / `remote-onu ip-host` / `remote-onu wan-ip` /
 * `remote-onu tr069-mgmt` / `mac gpon onu`) y de `verifyOnuProvisioning`,
 * extraídas de `zte-c320.driver.ts` (Fase 4 de
 * Plan_Implementacion_Refactor_ZteC320Driver.md). Cada función recibe una
 * sesión YA conectada (`ZteSessionLike`) -- el ciclo de vida
 * create/connect/close se queda en los métodos delgados de `ZteC320Driver`.
 */

/**
 * Verificación post-aprovisionamiento en la OLT:
 * 1. show gpon remote-onu ip-host gpon-onu_{port}:{onu_id} (valida IP en Host ID: 2)
 * 2. show mac gpon onu gpon-onu_{port}:{onu_id} (valida aprendizaje de MACs en VLANs)
 */
export async function verifyOnuProvisioningWithSession(
  session: ZteSessionLike,
  ponInterface: string,
  onuId: number,
  options?: { expectedVlans?: number[] },
): Promise<OnuProvisioningVerification> {
  const onuInterface = toOnuInterfaceName(ponInterface, onuId);
  const warnings: string[] = [];

  // 1. show gpon remote-onu ip-host gpon-onu_{port}:{onu_id}
  const rawIpHost = await session.executeCommand(`show gpon remote-onu ip-host ${onuInterface}`);
  const { mgmtIp, ipHostFound } = parseIpHost(rawIpHost);

  if (!mgmtIp) {
    warnings.push('Host ID: 2 no ha obtenido dirección IP (0.0.0.0 o sin asignar).');
  }

  // 2. show mac gpon onu gpon-onu_{port}:{onu_id}
  const rawMac = await session.executeCommand(`show mac gpon onu ${onuInterface}`);
  const learnedMacs = parseMacTable(rawMac);

  if (options?.expectedVlans && options.expectedVlans.length > 0) {
    for (const expectedVlan of options.expectedVlans) {
      const found = learnedMacs.some((lm) => lm.vlan === expectedVlan);
      if (!found) {
        warnings.push(`No se han aprendido direcciones MAC en la VLAN configurada ${expectedVlan}.`);
      }
    }
  }

  return {
    ok: warnings.length === 0,
    mgmtIp,
    ipHostFound,
    learnedMacs,
    warnings,
    rawIpHost,
    rawMac,
  };
}

/** "show gpon remote-onu ip-host <interfaz>" -- ver `IOltDriver.getOnuIpHost`. */
export async function getOnuIpHostWithSession(session: ZteSessionLike, ponInterface: string, onuId: number): Promise<OnuIpHostInfo> {
  const onuInterface = toOnuInterfaceName(ponInterface, onuId);
  const raw = await session.executeCommand(`show gpon remote-onu ip-host ${onuInterface}`);
  return { ...parseIpHost(raw), raw };
}

/** "show mac gpon onu <interfaz>" -- ver `IOltDriver.getOnuMacTable`. */
export async function getOnuMacTableWithSession(
  session: ZteSessionLike,
  ponInterface: string,
  onuId: number,
): Promise<Array<{ mac: string; vlan: number }>> {
  const onuInterface = toOnuInterfaceName(ponInterface, onuId);
  const raw = await session.executeCommand(`show mac gpon onu ${onuInterface}`);
  return parseMacTable(raw);
}

/**
 * "show gpon onu detail-info <interfaz>" -- ver `IOltDriver.getOnuDetailInfo`.
 * Campos confirmados en vivo (2026-10-28, OLT_Tabara_Abajo, ONU
 * ECOM0F91DF9B): "Type: <nombre>", "Config state: <success|fail>". Los
 * demás campos (`onlineDuration`, `adminState`) se parsean con el mismo
 * criterio ("Etiqueta: valor") pero sin una muestra en vivo tan completa
 * como la de Type/Config state -- si el formato real difiere, quedan
 * `undefined` en vez de inventar un valor; `raw` siempre se devuelve
 * completo para revisión manual.
 */
export async function getOnuDetailInfoWithSession(session: ZteSessionLike, ponInterface: string, onuId: number): Promise<OnuDetailInfo> {
  const onuInterface = toOnuInterfaceName(ponInterface, onuId);
  const raw = await session.executeCommand(`show gpon onu detail-info ${onuInterface}`);
  return parseOnuDetailInfo(raw);
}

/**
 * "show gpon remote-onu wan-ip <interfaz>" -- ver `IOltDriver.getOnuWanIp`.
 * SIN muestra real confirmada en vivo para el formato exacto de esta
 * salida (ver Plan_Implementacion_WanIp_VlanProfile_HGU.md, Fase 0) --
 * parseo mejor-esfuerzo por posición (primera IPv4/MAC encontrada = host
 * 1, segunda = host 2). `raw` siempre se devuelve completo para que el
 * operador confirme a ojo si el parseo posicional se equivocó.
 */
export async function getOnuWanIpWithSession(session: ZteSessionLike, ponInterface: string, onuId: number): Promise<OnuWanIpInfo> {
  const onuInterface = toOnuInterfaceName(ponInterface, onuId);
  const raw = await session.executeCommand(`show gpon remote-onu wan-ip ${onuInterface}`);

  const ipMatches = [...raw.matchAll(/(\d{1,3}(?:\.\d{1,3}){3})/g)].map((m) => m[1]);
  const macMatches = [...raw.matchAll(/([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}|[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/g)].map(
    (m) => m[1],
  );

  return {
    host1: ipMatches[0] || macMatches[0] ? { ip: ipMatches[0], mac: macMatches[0] } : undefined,
    host2: ipMatches[1] || macMatches[1] ? { ip: ipMatches[1], mac: macMatches[1] } : undefined,
    raw,
  };
}

/**
 * "show gpon remote-onu tr069-mgmt <interfaz>" -- ver
 * `IOltDriver.getOnuTr069MgmtInfo`. Lectura (distinta de los comandos de
 * escritura "tr069-mgmt N ..." que sí usa `generateTr069ManagementScript`).
 * SIN muestra real confirmada en vivo para el formato exacto -- parseo
 * mejor-esfuerzo, `raw` siempre completo.
 */
export async function getOnuTr069MgmtInfoWithSession(
  session: ZteSessionLike,
  ponInterface: string,
  onuId: number,
): Promise<OnuTr069MgmtInfo> {
  const onuInterface = toOnuInterfaceName(ponInterface, onuId);
  const raw = await session.executeCommand(`show gpon remote-onu tr069-mgmt ${onuInterface}`);

  return {
    adminStatus: raw.match(/Admin\s*status:\s*(\S+)/i)?.[1],
    acsUrl: raw.match(/(https?:\/\/\S+)/i)?.[1],
    vlanTag: raw.match(/vlan\s*:?\s*(\d+)/i)?.[1],
    raw,
  };
}
