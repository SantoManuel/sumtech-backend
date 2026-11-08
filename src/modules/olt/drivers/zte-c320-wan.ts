import { BadRequestException } from '@nestjs/common';
import { ConfigureOnuWanParams, OnuOmciWanProfile, OnuWanApplyResult, OnuWanConfiguration } from '../ports/onu-wan.types';
import { ZteSessionLike } from './zte-telnet-session';
import { isOltErrorResponse } from './zte-c320-parsers';
import { redactOltCli } from '../utils/redact-olt-cli';

export function validateOmciWanParams(input: ConfigureOnuWanParams): void {
  if (!/^gpon-onu_\d+\/\d+\/\d+:\d+$/.test(input.onuInterface)) throw new BadRequestException('Interfaz GPON inválida.');
  const p = input.profile;
  if (!p.enabled || p.serialNumber !== input.serialNumber || !['STANDARD', 'PILOT', 'VALIDATED'].includes(p.validation)) {
    throw new BadRequestException('La configuración OMCI no corresponde a esta ONU.');
  }
  validateOmciWanProfile(p);
  const mode = input.wanMode || 'PPPOE';
  if (mode === 'PPPOE') {
    if (!input.username || !input.password) {
      throw new BadRequestException('El modo PPPoE requiere usuario y contraseña.');
    }
    for (const [label, token] of [['Usuario PPPoE', input.username], ['Contraseña PPPoE', input.password]]) {
      if (!/^[A-Za-z0-9_@.\/+,:=!?%$*-]{1,128}$/.test(token)) {
        throw new BadRequestException(`${label}: contiene caracteres que esta receta CLI no admite.`);
      }
    }
  } else if (mode === 'STATIC') {
    if (!input.wanStaticIp || !input.wanStaticMask || !input.wanStaticGw) {
      throw new BadRequestException('El modo Estática requiere IP, máscara y puerta de enlace.');
    }
  } else if (mode !== 'DHCP') {
    throw new BadRequestException(`Modo WAN OMCI no soportado: ${mode}`);
  }
}

export function validateOmciWanProfile(p: OnuOmciWanProfile): void {
  const style = p.commandStyle ?? 'WAN_IP';
  if (!['WAN_IP', 'WAN_SERVICE'].includes(style) ||
      !Number.isInteger(p.serviceVlan) || p.serviceVlan < 1 || p.serviceVlan > 4094 ||
      !Number.isInteger(p.wanIndex) || p.wanIndex < 1 || p.wanIndex > 8 ||
      !Number.isInteger(p.hostId) || p.hostId < 1 || p.hostId > 8) {
    throw new BadRequestException('Receta WAN OMCI inválida.');
  }
  if (style === 'WAN_IP' && (!/^[A-Za-z0-9_.-]{1,100}$/.test(p.vlanProfile || '') || !['pap','chap','auto'].includes(p.auth || ''))) {
    throw new BadRequestException('La receta WAN-IP requiere un perfil VLAN y autenticación válidos.');
  }
  if (style === 'WAN_SERVICE' && (!validPortRange(p.ethUniPorts) || !validPortRange(p.ssidPorts))) {
    throw new BadRequestException('Los puertos LAN y SSID requieren un puerto o rango ascendente entre 1 y 4.');
  }
}

function validPortRange(value?: string): boolean {
  if (!value || !/^[1-4](?:-[1-4])?$/.test(value)) return false;
  const [first, last = first] = value.split('-').map(Number);
  return first <= last;
}

function normalizedPorts(value?: string): string | undefined {
  if (!value) return undefined;
  const ports = new Set<number>();
  for (const item of value.trim().split(/[,\s]+/)) {
    if (!validPortRange(item)) return undefined;
    const [first, last = first] = item.split('-').map(Number);
    for (let port = first; port <= last; port++) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b).join(',');
}

/** Genera los comandos CLI OMCI según el modo (PPPoE, DHCP o Estática). */
export function buildZteWanCommands(input: ConfigureOnuWanParams): string[] {
  validateOmciWanParams(input);
  const p = input.profile;
  const mode = input.wanMode || 'PPPOE';

  if (mode === 'DHCP') {
    if (p.commandStyle === 'WAN_SERVICE') {
      return [
        `wan ${p.wanIndex} ethuni ${p.ethUniPorts} ssid ${p.ssidPorts} service internet`,
        `wan ${p.wanIndex} service internet host ${p.hostId} dhcp`,
        `ip-host ${p.hostId} dhcp-enable enable ping-response enable traceroute-response enable`,
        `vlan wan ${p.wanIndex} mode tag vlan ${p.serviceVlan}`,
      ];
    }
    return [`ip-host ${p.hostId} dhcp-enable enable ping-response enable traceroute-response enable`];
  }

  if (mode === 'STATIC') {
    if (p.commandStyle === 'WAN_SERVICE') {
      return [
        `wan ${p.wanIndex} ethuni ${p.ethUniPorts} ssid ${p.ssidPorts} service internet`,
        `wan ${p.wanIndex} service internet host ${p.hostId} static`,
        `ip-host ${p.hostId} ip ${input.wanStaticIp} mask ${input.wanStaticMask} gateway ${input.wanStaticGw} ping-response enable traceroute-response enable`,
        `vlan wan ${p.wanIndex} mode tag vlan ${p.serviceVlan}`,
      ];
    }
    return [`ip-host ${p.hostId} ip ${input.wanStaticIp} mask ${input.wanStaticMask} gateway ${input.wanStaticGw} ping-response enable traceroute-response enable`];
  }

  // mode === 'PPPOE'
  if (p.commandStyle === 'WAN_SERVICE') {
    return [
      `wan ${p.wanIndex} ethuni ${p.ethUniPorts} ssid ${p.ssidPorts} service internet`,
      `wan ${p.wanIndex} service internet host ${p.hostId} pppoe`,
      `pppoe ${p.hostId} nat enable user ${input.username} password ${input.password}`,
      `vlan wan ${p.wanIndex} mode tag vlan ${p.serviceVlan}`,
    ];
  }
  const auth = p.auth === 'auto' ? '' : ` auth ${p.auth}`;
  return [`wan-ip ${p.wanIndex} mode pppoe${auth} username ${input.username} password ${input.password} vlan-profile ${p.vlanProfile} host ${p.hostId}`];
}

export function matchesZteWanConfiguration(
  observed: OnuWanConfiguration,
  p: OnuOmciWanProfile,
  expectedOrUsername?: string | { wanMode?: string; username?: string; staticIp?: string; staticMask?: string },
): boolean {
  const expectedMode = typeof expectedOrUsername === 'string'
    ? 'pppoe'
    : (expectedOrUsername?.wanMode || 'PPPOE').toLowerCase();

  const expectedUsername = typeof expectedOrUsername === 'string'
    ? expectedOrUsername
    : expectedOrUsername?.username;

  const expectedStaticIp = typeof expectedOrUsername === 'object'
    ? expectedOrUsername?.staticIp
    : undefined;

  const expectedStaticMask = typeof expectedOrUsername === 'object'
    ? expectedOrUsername?.staticMask
    : undefined;

  if (observed.wanIndex !== p.wanIndex && observed.hostId !== p.hostId) return false;

  if (expectedMode === 'pppoe') {
    if (observed.mode !== 'pppoe' || (expectedUsername && observed.username !== expectedUsername)) {
      return false;
    }
  } else if (expectedMode === 'dhcp') {
    if (observed.mode !== 'dhcp' && !observed.dhcpEnabled) {
      return false;
    }
  } else if (expectedMode === 'static') {
    if (observed.mode !== 'static') return false;
    if (expectedStaticIp && observed.staticIp !== expectedStaticIp) return false;
    if (expectedStaticMask && observed.staticMask !== expectedStaticMask) return false;
  }

  if (p.commandStyle === 'WAN_SERVICE') {
    if (observed.commandStyle !== 'WAN_SERVICE') return false;
    if (observed.bindingService && observed.bindingService !== 'internet') return false;
    if (observed.service && observed.service !== 'internet') return false;
    if (observed.vlanMode && observed.vlanMode !== 'tag') return false;
    if (p.serviceVlan && observed.serviceVlan && observed.serviceVlan !== p.serviceVlan) return false;
    if (expectedMode === 'pppoe' && observed.natEnabled !== undefined && observed.natEnabled !== true) return false;
    if (p.ethUniPorts && observed.ethUniPorts && normalizedPorts(observed.ethUniPorts) !== normalizedPorts(p.ethUniPorts)) return false;
    if (p.ssidPorts && observed.ssidPorts && normalizedPorts(observed.ssidPorts) !== normalizedPorts(p.ssidPorts)) return false;
  }

  if (p.commandStyle === 'WAN_IP' && observed.vlanProfile) {
    if (observed.vlanProfile !== p.vlanProfile) return false;
  }

  return true;
}

/** Unknown output must never be interpreted as an empty WAN. */
export function parseZteWanConfiguration(raw: string, iface: string, wanIndex: number): OnuWanConfiguration {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex(l => l.trim() === `pon-onu-mng ${iface}`);
  if (start < 0) throw new Error('La lectura no contiene el bloque pon-onu-mng esperado; no se modificó la WAN.');
  const block: string[] = [];
  let closed = false;
  for (const line of lines.slice(start + 1)) {
    if (/^(?:!|exit|pon-onu-mng |interface )/.test(line.trim())) { closed = true; break; }
    block.push(line.trim());
  }
  if (!closed) throw new Error('La configuración WAN está incompleta; la lectura pudo quedar truncada.');
  const candidates = block.filter(l => new RegExp(`^wan-ip ${wanIndex} mode `).test(l));
  if (candidates.length > 1) throw new Error('Lectura WAN ambigua.');
  const hostBindings = block.flatMap(line => {
    const binding = line.match(/^wan (\d+) service \S+ host (\d+) \S+/) || line.match(/^wan-ip (\d+) mode .*\bhost (\d+)/);
    return binding ? [{ wanIndex: Number(binding[1]), hostId: Number(binding[2]) }] : [];
  });
  const bindings = block.filter(l => new RegExp(`^wan ${wanIndex} ethuni `).test(l));
  const services = block.filter(l => new RegExp(`^wan ${wanIndex} service `).test(l));
  const vlans = block.filter(l => new RegExp(`^vlan wan ${wanIndex} mode `).test(l));
  if (bindings.length > 1 || services.length > 1 || vlans.length > 1) throw new Error('Lectura WAN de servicio ambigua.');
  if (bindings.length || services.length || vlans.length) {
    if (candidates.length) throw new Error('El mismo índice WAN tiene recetas WAN-IP y WAN de servicio mezcladas.');
    const binding = bindings[0]?.match(/^wan \d+ ethuni (.+?) ssid (.+?) service (\S+)/);
    const service = services[0]?.match(/^wan \d+ service (\S+) host (\d+) (\S+)/);
    const hostId = service ? Number(service[2]) : wanIndex;
    const pppoeLines = block.filter(l => new RegExp(`^pppoe\\s+${hostId}\\b`).test(l));
    if (pppoeLines.length > 1) throw new Error('Lectura PPPoE ambigua.');
    const pppoeLine = pppoeLines[0];
    const username = pppoeLine?.match(/\buser\s+(\S+)/i)?.[1];
    const natMatch = pppoeLine?.match(/\bnat\s+(enable|disable)\b/i) || block.find(l => new RegExp(`^pppoe\\s+${hostId}\\b.*\\bnat\\s+(enable|disable)\\b`, 'i').test(l))?.match(/\bnat\s+(enable|disable)\b/i);
    const nat = natMatch?.[1];

    const dhcpLine = block.find(l => new RegExp(`^ip-host\\s+${hostId}\\b.*\\bdhcp-enable\\s+enable\\b`, 'i').test(l));
    const dhcpEnabled = Boolean(dhcpLine);

    const staticMatch = block.map(l => l.match(new RegExp(`^ip-host\\s+${hostId}\\s+ip\\s+(\\S+)\\s+mask\\s+(\\S+)\\s+gateway\\s+(\\S+)`, 'i'))).find(Boolean);
    const staticIp = staticMatch?.[1];
    const staticMask = staticMatch?.[2];
    const staticGw = staticMatch?.[3];

    let detectedMode = service?.[3];
    if (!detectedMode) {
      if (username || pppoeLines.length > 0) detectedMode = 'pppoe';
      else if (dhcpEnabled) detectedMode = 'dhcp';
      else if (staticIp) detectedMode = 'static';
    }

    const vlan = vlans[0]?.match(/^vlan wan \d+ mode (\S+) vlan (\d+)(?:\s|$)/);
    return {
      wanIndex, commandStyle: 'WAN_SERVICE', mode: detectedMode, service: service?.[1] || 'internet', hostId, username,
      dhcpEnabled, staticIp, staticMask, staticGw,
      ethUniPorts: binding?.[1], ssidPorts: binding?.[2], bindingService: binding?.[3] || 'internet',
      natEnabled: nat ? nat === 'enable' : pppoeLine ? true : undefined, vlanMode: vlan?.[1], serviceVlan: vlan ? Number(vlan[2]) : undefined,
      hostBindings,
      // Build evidence from parsed fields, never from a raw PPPoE password or its encrypted representation.
      evidence: [
        ...bindings,
        ...services,
        ...(username ? [`pppoe ${hostId} user ${username} password ***`] : []),
        ...(nat ? [`pppoe ${hostId} nat ${nat}`] : []),
        ...(dhcpEnabled ? [`ip-host ${hostId} dhcp-enable enable`] : []),
        ...(staticIp ? [`ip-host ${hostId} ip ${staticIp} mask ${staticMask} gateway ${staticGw}`] : []),
        ...vlans,
      ].join('\n'),
    };
  }

  const defaultHostId = wanIndex;
  const directPppoe = block.find(l => new RegExp(`^pppoe\\s+${defaultHostId}\\b`).test(l));
  const directDhcp = block.find(l => new RegExp(`^ip-host\\s+${defaultHostId}\\b.*\\bdhcp-enable\\s+enable\\b`, 'i').test(l));
  const directStatic = block.map(l => l.match(new RegExp(`^ip-host\\s+${defaultHostId}\\s+ip\\s+(\\S+)\\s+mask\\s+(\\S+)\\s+gateway\\s+(\\S+)`, 'i'))).find(Boolean);

  if (directPppoe || directDhcp || directStatic) {
    const u = directPppoe?.match(/\buser\s+(\S+)/i)?.[1];
    const n = directPppoe?.match(/\bnat\s+(enable|disable)\b/i)?.[1];
    const m = directPppoe ? 'pppoe' : directDhcp ? 'dhcp' : 'static';
    return {
      wanIndex,
      commandStyle: 'WAN_SERVICE',
      mode: m,
      service: 'internet',
      hostId: defaultHostId,
      username: u,
      natEnabled: n ? n === 'enable' : directPppoe ? true : undefined,
      dhcpEnabled: Boolean(directDhcp),
      staticIp: directStatic?.[1],
      staticMask: directStatic?.[2],
      staticGw: directStatic?.[3],
      hostBindings,
      evidence: directPppoe
        ? redactOltCli(directPppoe)
        : directDhcp
        ? directDhcp
        : directStatic
        ? directStatic[0]
        : '',
    };
  }

  const line = candidates[0] || '';
  return {
    wanIndex, commandStyle: line ? 'WAN_IP' : undefined, hostBindings,
    mode: line.match(/\bmode (\S+)/)?.[1], username: line.match(/\busername (\S+)/)?.[1],
    vlanProfile: line.match(/\bvlan-profile (\S+)/)?.[1],
    hostId: line.match(/\bhost (\d+)/) ? Number(line.match(/\bhost (\d+)/)![1]) : undefined,
    evidence: line ? redactOltCli(line) : `No hay wan-ip ${wanIndex} en el bloque observado.`,
  };
}

export function verifyZteVlanProfile(raw: string, name: string, vlan: number): void {
  const profiles = raw.split(/(?=Profile name\s*:)/i).filter(block => block.match(/^Profile name\s*:\s*(\S+)/i)?.[1] === name);
  if (profiles.length !== 1 || profiles[0].match(/Tag mode\s*:\s*(\S+)/i)?.[1].toLowerCase() !== 'tag' || Number(profiles[0].match(/CVLAN\s*:\s*(\d+)/i)?.[1]) !== vlan) {
    throw new Error('El perfil VLAN de la OLT no existe, no coincide con la VLAN de Internet o su lectura no es reconocible.');
  }
}

export async function getOnuWanConfigurationWithSession(session: ZteSessionLike, iface: string, index: number): Promise<OnuWanConfiguration> {
  if (!/^gpon-onu_\d+\/\d+\/\d+:\d+$/.test(iface) || !Number.isInteger(index) || index < 1 || index > 8) {
    throw new BadRequestException('Interfaz o índice WAN inválido.');
  }
  let raw = await session.executeCommand(`show onu running config ${iface}`, 10000).catch(() => '');
  if (!raw || isOltErrorResponse(raw) || !raw.includes(`pon-onu-mng ${iface}`)) {
    raw = await session.executeCommand('show running-config', 45000);
  }
  if (isOltErrorResponse(raw)) throw new Error('La OLT rechazó la lectura de configuración WAN.');
  const configuration = parseZteWanConfiguration(raw, iface, index);
  const detail = await session.executeCommand(`show gpon onu detail-info ${iface}`);
  return {
    ...configuration,
    serialNumber: detail.match(/(?:Serial\s*number|SerialNumber|SN)\s*:\s*(\S+)/i)?.[1],
    vendorTypeName: detail.match(/^\s*Type\s*:\s*(\S+)/im)?.[1],
    configState: detail.match(/^\s*Config state\s*:\s*(\S+)/im)?.[1],
  };
}

export async function configureOnuWanWithSession(session: ZteSessionLike, input: ConfigureOnuWanParams): Promise<OnuWanApplyResult> {
  validateOmciWanParams(input);
  const p = input.profile;
  const detail = await session.executeCommand(`show gpon onu detail-info ${input.onuInterface}`);
  const serial = detail.match(/(?:Serial\s*number|SerialNumber|SN)\s*:\s*(\S+)/i)?.[1];
  const type = detail.match(/^\s*Type\s*:\s*(\S+)/im)?.[1];
  if (serial !== input.serialNumber || (p.vendorTypeName && type !== p.vendorTypeName)) throw new Error('El serial o perfil ONU observado no coincide con la configuración OMCI.');
  const firmware = detail.match(/^\s*(?:Software\s*version|SoftwareVersion|Firmware\s*version)\s*:\s*(\S+)/im)?.[1];
  if ((firmware && p.onuFirmware && firmware !== p.onuFirmware) || (!firmware && p.validation === 'VALIDATED')) {
    throw new Error('No se pudo verificar el firmware ONU registrado para esta receta.');
  }
  if (p.commandStyle !== 'WAN_SERVICE') {
    verifyZteVlanProfile(await session.executeCommand('show gpon onu profile vlan'), p.vlanProfile!, p.serviceVlan);
  }
  const before = await getOnuWanConfigurationWithSession(session, input.onuInterface, p.wanIndex);
  if (before.commandStyle && before.commandStyle !== (p.commandStyle ?? 'WAN_IP')) {
    throw new BadRequestException('El índice WAN usa otra receta CLI. Requiere una migración explícita antes de reemplazarla.');
  }
  if (before.hostBindings?.some(binding => binding.hostId === p.hostId && binding.wanIndex !== p.wanIndex)) {
    throw new BadRequestException('El IP-host elegido ya está vinculado a otra WAN de esta ONU.');
  }
  const commands = buildZteWanCommands(input);
  let writing = false;
  try {
    const closing = p.commandStyle === 'WAN_SERVICE' ? ['end', 'write'] : ['exit', 'exit', 'write'];
    for (const cmd of ['configure terminal', `pon-onu-mng ${input.onuInterface}`, ...commands, ...closing]) {
      if (commands.includes(cmd)) writing = true;
      const output = await session.executeCommand(cmd);
      if (isOltErrorResponse(output)) {
        const codes = output.match(/%(?:Code|Error)\s+\d+/gi)?.join(', ') || 'rechazo CLI/OMCI';
        throw new Error(`La OLT rechazó la configuración WAN (${codes}).`);
      }
    }
    const observed = await getOnuWanConfigurationWithSession(session, input.onuInterface, p.wanIndex);
    const matches = matchesZteWanConfiguration(observed, p, {
      wanMode: input.wanMode || 'PPPOE',
      username: input.username,
      staticIp: input.wanStaticIp,
      staticMask: input.wanStaticMask,
    });
    const omciSuccess = observed.configState?.toLowerCase() === 'success' && observed.serialNumber === input.serialNumber;
    return {
      status: matches && omciSuccess ? 'APPLIED' : 'VERIFYING', configuration: observed,
      warning: matches && omciSuccess ? undefined : 'Comando enviado; falta confirmar la configuración y el estado OMCI de la ONU.',
    };
  } catch (error: any) {
    if (!writing) throw error;
    let reason = redactOltCli(String(error?.message || 'Error de comunicación'));
    if (input.password) reason = reason.split(input.password).join('***');
    return { status: 'UNKNOWN', warning: `La escritura WAN comenzó y no pudo confirmarse: ${reason.slice(0, 500)}. Consulta el equipo antes de reintentar.` };
  }
}
