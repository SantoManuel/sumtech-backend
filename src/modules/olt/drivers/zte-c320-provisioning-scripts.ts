import { AuthorizeOnuParams } from '../ports/olt-driver.port';


export function toOnuInterfaceName(ponInterface: string, onuId: number): string {
  const port = ponInterface.replace(/^gpon-(?:olt|onu)_/, '');
  return `gpon-onu_${port}:${onuId}`;
}


export function buildTr069FlowCommands(config: AuthorizeOnuParams): string[] {
  return [
    'flow 2 switch switch_0/1',
    'flow mode 2 tag-filter vlan-filter untag-filter discard',
    `no flow 2 pri 2 vlan ${config.tr069Vlan}`,
    `flow 2 pri 2 vlan ${config.tr069Vlan}`,
    'gemport 2 flow 2',
  ];
}


export function buildTr069SwitchportBindCommands(): string[] {
  return ['switchport-bind switch_0/1 iphost 2'];
}

export function buildTr069IpHostEnableCommand(): string[] {
  return ['ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable'];
}

export function buildTr069IpHostVlanFilterCommands(config: AuthorizeOnuParams): string[] {
  return [
    'vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard',
    `no vlan-filter iphost 2 pri 2 vlan ${config.tr069Vlan}`,
    `vlan-filter iphost 2 pri 2 vlan ${config.tr069Vlan}`,
  ];
}


export function buildTr069IpHostCommands(config: AuthorizeOnuParams): string[] {
  return [...buildTr069IpHostEnableCommand(), ...buildTr069IpHostVlanFilterCommands(config)];
}


export function buildDhcpIpEthuniCommands(config: AuthorizeOnuParams): string[] {
  if (config.ethuniDhcpDelegationSupported === false) {
    return [];
  }
  return Array.from({ length: config.ethPorts ?? 4 }, (_, i) => `dhcp-ip ethuni eth_0/${i + 1} from-onu`);
}


export function buildSecurityMgmtCommands(config: AuthorizeOnuParams): string[] {
  if (config.securityMgmtSupported === false) {
    return [];
  }
  return [
    'security-mgmt 998 state enable mode forward ingress-type lan protocol web https',
    'security-mgmt 999 state enable ingress-type lan protocol tr069',
  ];
}

export function buildTr069SecurityMgmtCommands(config: AuthorizeOnuParams): string[] {
  if (config.securityMgmtSupported === false) {
    return [];
  }
  return [
    'security-mgmt 998 state enable mode forward ingress-type lan protocol web https',
    'security-mgmt 999 state enable ingress-type lan protocol tr069',
  ];
}

export function buildTr069ApplicationCommands(config: AuthorizeOnuParams): string[] {
  return [
    'tr069-mgmt 1 state unlock',
    config.tr069AcsUsername && config.tr069AcsPassword
      ? `tr069-mgmt 1 acs ${config.tr069Url} validate basic username ${config.tr069AcsUsername} password ${config.tr069AcsPassword}`
      : `tr069-mgmt 1 acs ${config.tr069Url}`,
    `no tr069-mgmt 1 tag pri 2 vlan ${config.tr069Vlan}`,
    `tr069-mgmt 1 tag pri 2 vlan ${config.tr069Vlan}`,
  ];
}


export function isManagementOrTr069Command(cmd: string): boolean {
  return (
    cmd.startsWith('tcont 2') ||
    cmd.startsWith('gemport 2') ||
    cmd.startsWith('service-port 2') ||
    cmd.startsWith('flow 2') ||
    cmd.startsWith('flow mode 2') ||
    cmd.startsWith('switchport-bind switch_0/1 iphost 2') ||
    cmd.startsWith('switchport-bind switch_0/1 veip') ||
    cmd.startsWith('no switchport-bind switch_0/1 veip') ||
    cmd.startsWith('ip-host 2') ||
    cmd.startsWith('vlan-filter-mode iphost 2') ||
    cmd.startsWith('vlan-filter iphost 2') ||
    cmd.startsWith('voip') ||
    cmd.startsWith('veip') ||
    cmd.startsWith('tr069-mgmt') ||
    cmd.startsWith('security-mgmt')
  );
}


export function isPreparatoryTeardownCommand(cmd: string): boolean {
  return (
    cmd.startsWith('no service-port ') ||
    cmd === 'no switchport-bind switch_0/1 veip 1' ||
    /^no flow \d+ pri \d+ vlan \d+$/.test(cmd) ||
    /^no vlan-filter iphost \d+ pri \d+ vlan \d+$/.test(cmd) ||
    /^no tr069-mgmt \d+ tag pri \d+ vlan \d+$/.test(cmd)
  );
}

/**
 * Pausa de simulación humana (Human Pacing) adaptada al tiempo de convergencia
 * del hardware óptico, buffers del procesador de control y demonios OMCI de ZTE.
 */
export function getHumanPacingDelay(cmd: string): number {
  if (cmd.startsWith('onu ') && cmd.includes('type ') && cmd.includes('sn ')) {
    return 1500; // Registro de transceptor óptico y espera de .[Successful]
  }
  if (cmd.startsWith('pon-onu-mng ')) {
    return 1500; // Negociación y apertura de sesión de switch virtual OMCI
  }
  if (cmd === 'configure terminal') {
    return 350; // Asentamiento tras banner informativo %Info 20272
  }
  if (cmd === 'write') {
    return 1200; // Escritura en memoria no volátil
  }
  if (cmd === 'exit' || cmd === 'end') {
    return 250; // Cambio de contexto de sub-modo
  }
  return 120; // Pausa humana estándar entre comandos CLI
}


export function hasTr069Channel(config: AuthorizeOnuParams): boolean {
  return config.managementMethod === 'TR069' && Boolean(config.tr069Url);
}


export const SWITCHPORT_BIND_RE = /^switchport-bind switch_0\/1 \S+(?: \d+)?$/;


export function generateAuthorizationScript(config: AuthorizeOnuParams): string[] {
  const hasTr069 = hasTr069Channel(config);
  const onuInterface = toOnuInterfaceName(config.ponInterface, config.onuId);

  const commands: string[] = [
    // === FASE 1: Registro Físico en Puerto PON ===
    'configure terminal',
    `interface ${config.ponInterface}`,
    `no onu ${config.onuId}`,
    `onu ${config.onuId} type ${config.modelTypeName} sn ${config.serialNumber}`,
    'exit',

    // === FASE 2: Capa de Transporte GPON (T-CONT -> GEM -> Service-Port) ===
    `interface ${onuInterface}`,
    `name ${config.clientName ? config.clientName.replace(/\s+/g, '_') : `ONU-${config.onuId}`}`,
    ...(config.description ? [`description ${config.description.replace(/\s+/g, '_')}`] : []),
    `tcont 1 profile ${config.tcontProfile}`,
  ];

  if (hasTr069) {
    commands.push('tcont 2 profile SMARTOLT-VOIPMNG-10M');
  }

  commands.push(
    'gemport 1 tcont 1',
    'gemport 1 traffic-limit downstream SMARTOLT-1G-DOWN',
  );

  if (hasTr069) {
    commands.push(
      'gemport 2 tcont 2',
      'gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M',
    );
  }


  commands.push(
    `no service-port 1`,
    `service-port 1 vport 1 user-vlan ${config.serviceVlan} vlan ${config.serviceVlan}`,
  );
  if (hasTr069) {
    commands.push(
      `no service-port 2`,
      `service-port 2 vport 2 user-vlan ${config.tr069Vlan} vlan ${config.tr069Vlan}`,
    );
  }


  if (config.trafficProfile) {
    commands.push(`traffic-profile ${config.trafficProfile} vport 1 direction egress`);
  }

  commands.push(
    'exit',
    `pon-onu-mng ${onuInterface}`,
    'flow 1 switch switch_0/1',
    'flow mode 1 tag-filter vlan-filter untag-filter discard',
    `flow 1 pri 0 vlan ${config.serviceVlan}`,
    'gemport 1 flow 1',
  );

  if (hasTr069) {
    commands.push(...buildTr069FlowCommands(config));
  }

  commands.push('switchport-bind switch_0/1 iphost 1');
  if (hasTr069) {
    commands.push('switchport-bind switch_0/1 iphost 2');
  }

  if (hasTr069) {
    commands.push(...buildTr069IpHostEnableCommand());
  }

  commands.push(
    'vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard',
    `vlan-filter iphost 1 pri 0 vlan ${config.serviceVlan}`,
  );
  if (hasTr069) {
    commands.push(...buildTr069IpHostVlanFilterCommands(config));
  }

  // === FASE 6: Capa de Aplicación (Puertos ETH, VoIP, VEIP, TR-069 y Seguridad) ===
  commands.push(...buildDhcpIpEthuniCommands(config));
  commands.push(...buildSecurityMgmtCommands(config));

  if (hasTr069) {
    commands.push(...buildTr069ApplicationCommands(config));
  }

  // Cierre ordenado de sub-vistas (pon-onu-mng -> configure terminal -> EXEC) y persistencia
  commands.push('exit', 'exit', 'write');
  return commands;
}

/**
 * Script CLI del bloque OMCI que apunta la ONU al ACS (TR-069) -- Etapa 2 (Reintento aislado).
 * Mantiene el mismo orden jerárquico Bottom-Up para no corromper las entidades ME.
 */
export function generateTr069ManagementScript(config: AuthorizeOnuParams): string[] {
  if (!config.tr069Url) {
    throw new Error(
      'No se puede generar el bloque TR-069/ACS: falta la URL del ACS (tr069Url). Revisa que la Red TR-069 seleccionada tenga "acsUrl" configurado.',
    );
  }

  const onuInterface = toOnuInterfaceName(config.ponInterface, config.onuId);
  return [
    'configure terminal',
    `pon-onu-mng ${onuInterface}`,
    // 1. Inicializar Flow 2 en orden jerárquico ZTE GPONRM (flow 2 switch switch_0/1 primero)
    ...buildTr069FlowCommands(config),
    // 2. Vincular switch interno a iphost 2 (SOLO iphost 2, SIN veip 1)
    ...buildTr069SwitchportBindCommands(),
    // 3. Configurar IP-Host 2 (DHCP activo) y su filtro de VLAN en orden
    ...buildTr069IpHostCommands(config),
    // 4. TR-069/ACS + reglas seguridad 998+999 (solo tr069)
    ...buildTr069ApplicationCommands(config),
    ...buildTr069SecurityMgmtCommands(config),
    'end',
    'write',
  ];
}


export function generateTr069TransportScript(config: AuthorizeOnuParams): string[] {
  const onuInterface = toOnuInterfaceName(config.ponInterface, config.onuId);
  return [
    'configure terminal',
    `interface ${onuInterface}`,
    'tcont 2 profile SMARTOLT-VOIPMNG-10M',
    'gemport 2 tcont 2',
    'gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M',
    'no service-port 2',
    `service-port 2 vport 2 user-vlan ${config.tr069Vlan} vlan ${config.tr069Vlan}`,
    'exit',
    'exit',
    'write',
  ];
}


export function generateTr069ProfileScript(config: AuthorizeOnuParams): string[] {
  return [...generateTr069TransportScript(config), ...generateTr069ManagementScript(config)];
}

/**
 * Sentinel reconocido por `authorizeOnu()` dentro del array de comandos que
 * devuelve `generateAuthorizationScript()` -- un reinicio OMCI del ONT exige
 * confirmar un prompt interactivo ("Confirm to reboot? [yes/no]:") que no es
 * un comando CLI plano, así que no puede representarse como una cadena normal
 * en ese array. Ver `ZteTelnetSession.rebootOnu()`.
 */
export const REBOOT_ONU_SENTINEL = '__SUMTECH_REBOOT_ONU__';
