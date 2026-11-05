import { AuthorizeOnuParams } from '../ports/olt-driver.port';
import { generateTr069ManagementScript, generateTr069TransportScript, toOnuInterfaceName } from './zte-c320-provisioning-scripts';
import { isOltErrorResponse } from './zte-c320-parsers';

export interface Tr069State { iface: string; transport: string[]; management: string[] }
export interface Tr069Step { command: string; scope: 'interface' | 'onu'; undo: string[] }
export function validateTr069Input(config: { ponInterface: string; onuId: number; tr069Url?: string; tr069Vlan?: number; tr069AcsUsername?: string; tr069AcsPassword?: string }, acsOnly = false): void {
  if (!/^gpon-(?:olt|onu)_\d+\/\d+\/\d+$/.test(config.ponInterface) || !Number.isInteger(config.onuId) || config.onuId < 1 || config.onuId > 128) throw new Error('Interfaz o identificador de ONU inválido.');
  if (!acsOnly && (!Number.isInteger(config.tr069Vlan) || config.tr069Vlan! < 1 || config.tr069Vlan! > 4094)) throw new Error('tr069Vlan debe estar entre 1 y 4094.');
  if (!config.tr069Url || /[\s\x00-\x1f\x7f;|`\\'"<>#]/.test(config.tr069Url)) throw new Error('URL ACS inválida para la CLI.');
  let url: URL;
  try { url = new URL(config.tr069Url); } catch { throw new Error('URL ACS inválida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('El ACS requiere HTTP(S) sin credenciales en la URL.');
  if (!!config.tr069AcsUsername !== !!config.tr069AcsPassword) throw new Error('Se requieren usuario y contraseña ACS juntos.');
  for (const token of [config.tr069AcsUsername, config.tr069AcsPassword]) {
    if (token && !/^[A-Za-z0-9_@.+,=!?%$*:/-]{1,128}$/.test(token)) throw new Error('Credenciales ACS con caracteres no admitidos por esta CLI.');
  }
}

function readBlock(lines: string[], header: string, required: boolean): string[] {
  const starts = lines.flatMap((line, index) => line === header ? [index] : []);
  if (starts.length > 1) throw new Error('Configuración ambigua: bloque repetido.');
  if (!starts.length) { if (required) throw new Error('No se encontró el bloque de la ONU; no se modificó configuración.'); return []; }
  const result: string[] = [];
  for (const line of lines.slice(starts[0] + 1)) {
    if (/^(?:!|exit|end)$/.test(line)) return result;
    if (/^(?:interface |pon-onu-mng )/.test(line)) throw new Error('Bloque truncado; no se modificó configuración.');
    if (line) result.push(line);
  }
  throw new Error('Lectura truncada; no se modificó configuración.');
}

/** Full running-config is read only. Never infer absence from an empty/unsupported response. */
export function parseTr069State(raw: string, iface: string, serialNumber?: string): Tr069State {
  if (!raw.trim() || isOltErrorResponse(raw)) throw new Error('No se pudo leer la configuración actual.');
  const lines = raw.split(/\r?\n/).map(line => line.trim());
  if (!lines.includes('end')) throw new Error('La lectura global está incompleta; falta el marcador end.');
  const transport = readBlock(lines, `interface ${iface}`, true);
  const management = readBlock(lines, `pon-onu-mng ${iface}`, false);
  if (serialNumber) {
    const physical = iface.replace('gpon-onu_', 'gpon-olt_').split(':')[0];
    const onuId = iface.split(':')[1];
    const registration = readBlock(lines, `interface ${physical}`, true).filter(line => new RegExp(`^onu ${onuId} type \\S+ sn \\S+$`).test(line));
    if (registration.length !== 1 || registration[0].split(' sn ')[1].toUpperCase() !== serialNumber.toUpperCase()) throw new Error('No se pudo confirmar el serial de la ONU en el puerto solicitado.');
  }
  return { iface, transport, management };
}

function key(cmd: string): string | undefined {
  const groups: Array<[RegExp, string]> = [
    [/^tcont 2 profile /, 'tcont'], [/^gemport 2 tcont /, 'gem-tcont'],
    [/^gemport 2 traffic-limit downstream /, 'gem-traffic'], [/^service-port 2 /, 'service'],
    [/^flow 2 switch /, 'flow-switch'], [/^flow mode 2 /, 'flow-mode'], [/^flow 2 pri /, 'flow-vlan'],
    [/^gemport 2 flow /, 'gem-flow'], [/^switchport-bind switch_0\/1 iphost 2$/, 'bind'],
    [/^ip-host 2 /, 'iphost'], [/^vlan-filter-mode iphost 2 /, 'filter-mode'], [/^vlan-filter iphost 2 /, 'filter'],
    [/^tr069-mgmt 1 state /, 'state'], [/^tr069-mgmt 1 acs /, 'acs'], [/^tr069-mgmt 1 tag /, 'tag'],
    [/^security-mgmt 998 /, 'security998'], [/^security-mgmt 999 /, 'security999'],
  ];
  return groups.find(([re]) => re.test(cmd))?.[1];
}
function removal(cmd: string): string | undefined {
  if (/^service-port 2 /.test(cmd)) return 'no service-port 2';
  if (/^(?:flow 2 pri \d+ vlan \d+|vlan-filter iphost 2 pri \d+ vlan \d+|tr069-mgmt 1 tag pri \d+ vlan \d+)$/.test(cmd)) return `no ${cmd}`;
  return undefined;
}
export function buildTr069Plan(config: AuthorizeOnuParams, state: Tr069State, acsOnly = false): Tr069Step[] {
  validateTr069Input(config, acsOnly);
  const iface = toOnuInterfaceName(config.ponInterface, config.onuId);
  if (state.iface !== iface) throw new Error('La instantánea pertenece a otra ONU.');
  if (!acsOnly) {
    const unrelated = state.transport.some(line => /^gemport (?!2\b)\d+ tcont 2\b|^service-port (?!2\b)\d+ .*\bvport 2\b/.test(line));
    if (unrelated || state.transport.some(line => /^gemport 2 tcont (?!2\b)|^service-port 2 vport (?!2\b)/.test(line)) ||
        state.management.some(line => /^gemport 2 flow (?!2\b)/.test(line))) throw new Error('El canal 2 está asociado a otro servicio; requiere revisión manual.');
    const existingChannel = state.transport.some(line => /^(?:tcont|gemport|service-port) 2\b/.test(line));
    if (existingChannel && (!state.management.some(line => /^tr069-mgmt 1 acs /.test(line)) ||
        !state.management.includes('switchport-bind switch_0/1 iphost 2'))) throw new Error('No se pudo acreditar que el canal 2 existente sea de gestión TR-069.');
  }
  const candidates: Array<{ scope: 'interface' | 'onu'; commands: string[]; observed: string[] }> = [
    { scope: 'interface', commands: acsOnly ? [] : generateTr069TransportScript(config), observed: state.transport },
    { scope: 'onu', commands: generateTr069ManagementScript(config).filter(cmd => !acsOnly || /^tr069-mgmt 1 acs /.test(cmd)), observed: state.management },
  ];
  const plan: Tr069Step[] = [];
  for (const { scope, commands, observed } of candidates) {
    for (const command of commands) {
      const k = key(command);
      if (!k) continue;
      const prior = observed.filter(line => key(line) === k);
      if (prior.length === 1 && prior[0] === command) continue;
      if (prior.length > 1 && !['flow-vlan', 'filter', 'tag'].includes(k)) throw new Error('Estado ambiguo del recurso de gestión.');
      // Do not silently discard existing authentication when credentials were omitted.
      if (k === 'acs' && prior.some(line => / validate /.test(line)) && !config.tr069AcsUsername) {
        if (prior.every(line => line.split(' validate ')[0] === command)) continue;
        throw new Error('El ACS actual tiene autenticación; proporciona las credenciales para cambiarlo.');
      }
      if (prior.length && ['tcont', 'gem-tcont', 'gem-traffic', 'gem-flow', 'flow-switch', 'bind', 'security998', 'security999'].includes(k)) throw new Error('Conflicto de recursos del canal de gestión.');
      for (const old of prior) {
        const remove = removal(old);
        if (remove) plan.push({ scope, command: remove, undo: [old] });
      }
      const removeNew = removal(command);
      // The preceding removal steps restore the old values during compensation.
      plan.push({ scope, command, undo: prior.some(old => !!removal(old)) && removeNew ? [removeNew] : prior.length ? prior : (removeNew ? [removeNew] : []) });
    }
  }
  return plan;
}
