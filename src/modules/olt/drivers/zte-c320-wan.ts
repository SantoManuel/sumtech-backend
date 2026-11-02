import { BadRequestException } from '@nestjs/common';
import { ConfigureOnuWanParams, OnuWanApplyResult, OnuWanConfiguration } from '../ports/onu-wan.types';
import { ZteSessionLike } from './zte-telnet-session';
import { isOltErrorResponse } from './zte-c320-parsers';
import { redactOltCli } from '../utils/redact-olt-cli';

export function validateOmciWanParams(input: ConfigureOnuWanParams): void {
  if (!/^gpon-onu_\d+\/\d+\/\d+:\d+$/.test(input.onuInterface)) throw new BadRequestException('Interfaz GPON inválida.');
  const p = input.profile;
  if (!p.enabled || p.serialNumber !== input.serialNumber || !['PILOT', 'VALIDATED'].includes(p.validation)) {
    throw new BadRequestException('La receta OMCI no está habilitada para este serial.');
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(p.vlanProfile) ||
      !Number.isInteger(p.wanIndex) || p.wanIndex < 1 || p.wanIndex > 8 ||
      !Number.isInteger(p.hostId) || p.hostId < 1 || p.hostId > 8 || !['pap','chap','auto'].includes(p.auth)) {
    throw new BadRequestException('Receta WAN OMCI inválida.');
  }
  for (const [label, token] of [['Usuario PPPoE', input.username], ['Contraseña PPPoE', input.password]]) {
    if (!/^[A-Za-z0-9_@.\/+,:=!?%$*-]{1,128}$/.test(token)) {
      throw new BadRequestException(`${label}: contiene caracteres que esta receta CLI no admite.`);
    }
  }
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
  const line = candidates[0] || '';
  return {
    wanIndex, mode: line.match(/\bmode (\S+)/)?.[1], username: line.match(/\busername (\S+)/)?.[1],
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
  const raw = await session.executeCommand('show running-config', 45000);
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
  if (serial !== input.serialNumber || type !== p.vendorTypeName) throw new Error('El serial o perfil ONU observado no coincide con la receta OMCI.');
  const firmware = detail.match(/^\s*(?:Software\s*version|SoftwareVersion|Firmware\s*version)\s*:\s*(\S+)/im)?.[1];
  if ((firmware && firmware !== p.onuFirmware) || (!firmware && p.validation === 'VALIDATED')) {
    throw new Error('No se pudo verificar el firmware ONU registrado para esta receta.');
  }
  verifyZteVlanProfile(await session.executeCommand('show gpon onu profile vlan'), p.vlanProfile, p.serviceVlan);
  await getOnuWanConfigurationWithSession(session, input.onuInterface, p.wanIndex);
  const auth = p.auth === 'auto' ? '' : ` auth ${p.auth}`;
  const command = `wan-ip ${p.wanIndex} mode pppoe${auth} username ${input.username} password ${input.password} vlan-profile ${p.vlanProfile} host ${p.hostId}`;
  let writing = false;
  try {
    for (const cmd of ['configure terminal', `pon-onu-mng ${input.onuInterface}`, command, 'exit', 'exit', 'write']) {
      if (cmd === command) writing = true;
      const output = await session.executeCommand(cmd);
      if (isOltErrorResponse(output)) {
        const codes = output.match(/%(?:Code|Error)\s+\d+/gi)?.join(', ') || 'rechazo CLI/OMCI';
        throw new Error(`La OLT rechazó la configuración PPPoE (${codes}).`);
      }
    }
    const observed = await getOnuWanConfigurationWithSession(session, input.onuInterface, p.wanIndex);
    const matches = observed.mode === 'pppoe' && observed.username === input.username && observed.vlanProfile === p.vlanProfile && observed.hostId === p.hostId;
    const omciSuccess = observed.configState?.toLowerCase() === 'success' && observed.serialNumber === input.serialNumber;
    return {
      status: matches && omciSuccess ? 'APPLIED' : 'VERIFYING', configuration: observed,
      warning: matches && omciSuccess ? undefined : 'Comando enviado; falta confirmar la configuración y el estado OMCI de la ONU.',
    };
  } catch (error: any) {
    if (!writing) throw error;
    const reason = redactOltCli(String(error?.message || 'Error de comunicación')).split(input.password).join('***').slice(0, 500);
    return { status: 'UNKNOWN', warning: `La escritura WAN comenzó y no pudo confirmarse: ${reason}. Consulta el equipo antes de reintentar.` };
  }
}
