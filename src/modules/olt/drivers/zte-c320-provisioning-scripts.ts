import { AuthorizeOnuParams } from '../ports/olt-driver.port';

/**
 * Generadores del script CLI de aprovisionamiento ZTE C320 -- extraídos de
 * `zte-c320.driver.ts` (Fase 3 de Plan_Implementacion_Refactor_ZteC320Driver.md).
 *
 * `generateAuthorizationScript()` (Etapa 1, canal de Internet + canal de
 * gestión TR-069 opcional) y `generateTr069ManagementScript()` (Etapa 2,
 * reintento aislado SOLO del canal de gestión) compartían ~70% del mismo
 * bloque de comandos del canal de gestión -- confirmado línea por línea al
 * hacer este refactor. Se factorizó en 5 funciones `buildTr069*`/
 * `buildDhcpIpEthuniCommands`, cada una llamada en el MISMO punto relativo
 * donde ya vivía el código inline en ambos generadores -- NINGUNA se movió
 * de posición respecto al resto del script. Esto es deliberado: el orden de
 * los comandos es jerárquicamente estricto (confirmado en vivo contra OLTs
 * reales, ver comentarios de cada bloque) y el canal de Internet (flow 1 /
 * switchport-bind iphost 1 / ip-host 1) de `generateAuthorizationScript` va
 * INTERCALADO entre estos bloques del canal de gestión, no antes o después
 * como un todo -- combinarlos en una sola función "todo en uno" habría
 * exigido reordenar ese intercalado, cambiando comportamiento real sin
 * ninguna evidencia en vivo de que el nuevo orden siga funcionando. No
 * "simplificar" de vuelta a un solo bloque sin volver a confirmar en vivo.
 */

/** "no onu X" -> "interface gpon-onu_X/X/X:Y" usa prefijos distintos ("olt" para el puerto físico, "onu" para la sub-interfaz de cada ONU autorizada en ese puerto), no el mismo nombre con ":<id>" pegado. Bug real confirmado en vivo contra OLT_Tabara_Abajo (2026-10-20): "interface gpon-olt_1/2/15:1" rechazado con "%Error 20202: Invalid input detected ... Invalid parameter". */
export function toOnuInterfaceName(ponInterface: string, onuId: number): string {
  return `${ponInterface.replace(/^gpon-olt_/, 'gpon-onu_')}:${onuId}`;
}

/**
 * FASE 3 (parcial) del canal de gestión: flow 2 + gemport 2 flow 2.
 *
 * "no flow 2 pri 2 vlan <N>" ANTES de asignarlo -- mismo criterio que "no
 * service-port <N>" (destruir y recrear limpio, ver generateAuthorizationScript):
 * este comando carga un valor de VLAN embebido igual que "service-port ...
 * vlan ..." (el bug real confirmado en vivo, 2026-10-30), y la OLT ya
 * documentó tolerar "flow <n> switch switch_0/1 y comandos similares del
 * bloque OMCI" como "ya existe" sin verificar el valor -- el mismo riesgo no
 * verificado se extiende a esta sub-asignación de "pri"/"vlan" del mismo
 * objeto flow. Sintaxis "no flow <N> pri <P> vlan <V>" ya usada y
 * confirmada en vivo en `applyServiceGemportFixWithSession` (Opción B).
 */
export function buildTr069FlowCommands(config: AuthorizeOnuParams): string[] {
  return [
    'flow 2 switch switch_0/1',
    'flow mode 2 tag-filter vlan-filter untag-filter discard',
    `no flow 2 pri 2 vlan ${config.tr069Vlan}`,
    `flow 2 pri 2 vlan ${config.tr069Vlan}`,
    'gemport 2 flow 2',
  ];
}

/** FASE 4 (parcial) del canal de gestión: vincula iphost 2 y veip 1 al switch virtual. */
export function buildTr069SwitchportBindCommands(): string[] {
  return ['switchport-bind switch_0/1 iphost 2', 'switchport-bind switch_0/1 veip 1'];
}

/** FASE 5a (parcial) del canal de gestión: solo "ip-host 2 dhcp-enable ...". */
export function buildTr069IpHostEnableCommand(): string[] {
  return ['ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable'];
}

/**
 * FASE 5b (parcial) del canal de gestión: vlan-filter-mode + vlan-filter de
 * iphost 2. "no vlan-filter iphost 2 pri 2 vlan <N>" antes de asignarlo --
 * mismo riesgo (sin verificar en vivo todavía) de valor VLAN embebido que
 * "flow 2 pri 2 vlan <N>" de arriba; ver esa nota.
 */
export function buildTr069IpHostVlanFilterCommands(config: AuthorizeOnuParams): string[] {
  return [
    'vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard',
    `no vlan-filter iphost 2 pri 2 vlan ${config.tr069Vlan}`,
    `vlan-filter iphost 2 pri 2 vlan ${config.tr069Vlan}`,
  ];
}

/**
 * FASE 5 (parcial) del canal de gestión: ip-host 2 + su filtro de VLAN,
 * combinados -- usado por el reintento aislado de Etapa 2
 * (`generateTr069ManagementScript`), donde no existe un iphost 1 con el
 * cual agrupar. `generateAuthorizationScript` usa en cambio las dos
 * funciones separadas de arriba, para agrupar "ambos ip-host" antes que
 * "ambos vlan-filter" (ver FASE 5 de ese generador).
 */
export function buildTr069IpHostCommands(config: AuthorizeOnuParams): string[] {
  return [...buildTr069IpHostEnableCommand(), ...buildTr069IpHostVlanFilterCommands(config)];
}

/**
 * "dhcp-ip ethuni ... from-onu" solo si el modelo lo soporta por OMCI --
 * algunos modelos (ej. HUAWEY-BT546XG) lo rechazan con "%Code 63993 :
 * unknown ME", lo que deja el resto de la transacción OMCI en "fail".
 * Gateado de forma independiente a `hasTr069`: `generateAuthorizationScript`
 * lo aplica también a ONUs sin TR-069 (DHCP de los puertos LAN del propio
 * cliente), no es exclusivo del canal de gestión.
 */
export function buildDhcpIpEthuniCommands(config: AuthorizeOnuParams): string[] {
  if (config.ethuniDhcpDelegationSupported === false) {
    return [];
  }
  return Array.from({ length: config.ethPorts ?? 4 }, (_, i) => `dhcp-ip ethuni eth_0/${i + 1} from-onu`);
}

/**
 * FASE 6 (parcial) del canal de gestión: VoIP/VEIP/TR-069-mgmt y, si el
 * modelo lo soporta, las reglas "security-mgmt ..." (acceso remoto
 * HTTPS/SSH/Telnet/FTP/SNMP -- NO necesarias para el registro TR-069, que
 * ya depende solo de iphost 2/VEIP cableado por `buildTr069IpHostCommands`/
 * `buildTr069SwitchportBindCommands`).
 */
export function buildTr069ApplicationCommands(config: AuthorizeOnuParams): string[] {
  const commands = [
    'voip protocol sip',
    'veip 1 port udp 1232 host 2',
    'tr069-mgmt 1 state unlock',
    config.tr069AcsUsername && config.tr069AcsPassword
      ? `tr069-mgmt 1 acs ${config.tr069Url} validate basic username ${config.tr069AcsUsername} password ${config.tr069AcsPassword}`
      : `tr069-mgmt 1 acs ${config.tr069Url}`,
    // "no tr069-mgmt 1 tag pri 2 vlan <N>" antes de asignarlo -- mismo
    // riesgo (sin verificar en vivo todavía) de valor VLAN embebido que
    // "flow 2 pri 2 vlan <N>"/"vlan-filter iphost 2 pri 2 vlan <N>" de
    // arriba; ver esa nota en buildTr069FlowCommands.
    `no tr069-mgmt 1 tag pri 2 vlan ${config.tr069Vlan}`,
    `tr069-mgmt 1 tag pri 2 vlan ${config.tr069Vlan}`,
  ];

  if (config.securityMgmtSupported !== false) {
    commands.push(
      'security-mgmt 5 state enable mode forward protocol web https',
      'security-mgmt 998 state enable mode forward ingress-type lan protocol web https',
      'security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069',
    );
  }

  return commands;
}

/**
 * Determina si un comando pertenece al canal de gestión secundario (TR-069, VoIP, VEIP, Firewall)
 * que debe tratarse como mejor esfuerzo (no crítico) para no abortar la provisión de Internet.
 */
export function isManagementOrTr069Command(cmd: string): boolean {
  return (
    cmd.startsWith('tcont 2') ||
    cmd.startsWith('gemport 2') ||
    cmd.startsWith('service-port 2') ||
    cmd.startsWith('flow 2') ||
    cmd.startsWith('flow mode 2') ||
    cmd.startsWith('switchport-bind switch_0/1 iphost 2') ||
    cmd.startsWith('switchport-bind switch_0/1 veip') ||
    cmd.startsWith('ip-host 2') ||
    cmd.startsWith('vlan-filter-mode iphost 2') ||
    cmd.startsWith('vlan-filter iphost 2') ||
    cmd.startsWith('voip') ||
    cmd.startsWith('veip') ||
    cmd.startsWith('tr069-mgmt') ||
    cmd.startsWith('security-mgmt')
  );
}

/**
 * Reconoce los comandos "no ..." puramente preparatorios (destruir antes de
 * recrear) que preceden a una asignación con valor embebido (VLAN) -- mismo
 * criterio que "no onu <id>"/"no service-port <N>": nunca deben tratarse
 * como rechazo real ni generar un `warning` confuso en la primera
 * autorización de una ONU (cuando el objeto todavía no existe y la OLT
 * responde "no existe" en vez de silencio). Usado por `authorizeOnu()`
 * (zte-c320.driver.ts) y `applyTr069ManagementWithSession()`
 * (zte-c320-tr069.ts) para ejecutarlos sin verificar su respuesta, igual que
 * ya se hace con "no service-port <N>".
 */
export function isPreparatoryTeardownCommand(cmd: string): boolean {
  return (
    cmd.startsWith('no service-port ') ||
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

/**
 * ¿Esta autorización incluye el canal de gestión/TR-069 en la misma sesión?
 * Extraído a función compartida para que `authorizeOnu()` (que necesita
 * saberlo ANTES de generar el script, para asegurar los perfiles TCONT/
 * Traffic hardcodeados de este canal) use exactamente el mismo criterio que
 * `generateAuthorizationScript()`, sin duplicar la condición y arriesgarse
 * a que diverjan.
 */
export function hasTr069Channel(config: AuthorizeOnuParams): boolean {
  return config.managementMethod === 'TR069' && Boolean(config.tr069Url);
}

/**
 * Reconoce "flow <N> switch switch_0/1" -- compartido entre `authorizeOnu()`
 * (zte-c320.driver.ts, canal 1) y `applyTr069ManagementWithSession()`
 * (zte-c320-tr069.ts, canal 2 vía Etapa 2) para que ambos bucles de comandos
 * apliquen el MISMO re-enlace forzado cuando la OLT tolera el bind como "ya
 * existe" (ver la nota en cada uno). Antes solo vivía en `authorizeOnu()`;
 * tras el desacople de Etapa 1/Etapa 2 (2026-10-30), Etapa 2 es el único
 * camino para aplicar el canal de gestión/TR-069, así que necesita la misma
 * protección contra un bind "flow 2" que quedó de un intento anterior sin
 * re-enlazar de verdad.
 */
export const FLOW_SWITCH_BIND_RE = /^flow \d+ switch switch_0\/1$/;

/**
 * Genera la lista de comandos Telnet de autorización y aprovisionamiento (RF-OLT-016 / RF-ONU-001..007)
 * respetando el orden jerárquico estricto de entidades OMCI (Bottom-Up).
 */
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

  // "no service-port <N>" ANTES de crearlo -- bug real confirmado en vivo
  // (2026-10-30, ONU CMDCDD4D131E): al reautorizar con una Red TR-069
  // distinta (VLAN nueva), la OLT toleraba "service-port 2 ..." como "ya
  // existe" y dejaba el service-port apuntando a la VLAN VIEJA (444)
  // mientras el cableado OMCI (flow/vlan-filter) ya usaba la VLAN nueva
  // (46) -- un desajuste silencioso entre capas que impedía para siempre
  // que el canal de gestión cruzara tráfico. Mismo criterio que "no onu
  // <id>" antes de recrear la ONU: destruir y recrear limpio en vez de
  // confiar en el estado existente.
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

  // "traffic-profile ... vport 1 ..." va DESPUÉS de crear los service-port
  // (no antes) -- CONFIRMADO EN VIVO (2026-10-29): el vport que referencia
  // solo queda enlazado una vez que "service-port 1 vport 1 ..." lo crea.
  if (config.trafficProfile) {
    commands.push(`traffic-profile ${config.trafficProfile} vport 1 direction egress`);
  }

  commands.push(
    'exit',

    // === FASE 3: Inicialización de Flows y Mapeo GEM (pon-onu-mng) ===
    // Orden estricto ZTE GPONRM:
    // 1° Instanciar flow en el switch: flow <id> switch switch_0/1 (sin esto, OLT rechaza con %Code 63953 "Flow does not exist")
    // 2° flow mode <id> tag-filter vlan-filter untag-filter discard
    // 3° flow <id> pri <prio> vlan <vlan>
    // 4° gemport <id> flow <id>
    `pon-onu-mng ${onuInterface}`,
    'flow 1 switch switch_0/1',
    'flow mode 1 tag-filter vlan-filter untag-filter discard',
    `flow 1 pri 0 vlan ${config.serviceVlan}`,
    'gemport 1 flow 1',
  );

  if (hasTr069) {
    commands.push(...buildTr069FlowCommands(config));
  }

  // === FASE 4: Vinculación del Switch Virtual (switchport-bind) ===
  // Debe ejecutarse después de los flows y ANTES de configurar ip-host o veip
  commands.push('switchport-bind switch_0/1 iphost 1');
  if (hasTr069) {
    commands.push(...buildTr069SwitchportBindCommands());
  }

  // === FASE 5: Configuración de IP-Host y Filtros de VLAN ===
  // CONFIRMADO EN VIVO (2026-10-29): primero se activan AMBOS ip-host
  // (dhcp-enable) y recién DESPUÉS se aplican AMBOS vlan-filter -- no
  // intercalado por host (host 1 completo, luego host 2) como antes.
  commands.push('ip-host 1 dhcp-enable enable ping-response enable traceroute-response enable');
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
    // 1. Inicializar Flow 2 en orden jerárquico ZTE GPONRM
    ...buildTr069FlowCommands(config),
    // 2. Vincular puertos al switch_0/1 antes de filtrarlos
    ...buildTr069SwitchportBindCommands(),
    // 3. Configurar IP-Host 2 y su filtro de VLAN en orden
    ...buildTr069IpHostCommands(config),
    // 4. Puertos LAN, VoIP, VEIP, TR-069 y Firewall al final
    ...buildDhcpIpEthuniCommands(config),
    ...buildTr069ApplicationCommands(config),
    // 5. Reinicio OMCI ÚNICAMENTE cuando ya se enviaron tag y security-mgmt
    REBOOT_ONU_SENTINEL,
    'end',
    'write',
  ];
}

/**
 * Script CLI de la capa de TRANSPORTE del canal de gestión/TR-069 (tcont 2/
 * gemport 2/service-port 2) -- fuente única de verdad de los literales de
 * comando que ejecuta `ensureTr069TransportWithSession()` (zte-c320-tr069.ts)
 * contra una sesión real, reutilizada aquí SOLO para previsualización (sin
 * tocar la OLT). "no service-port 2" antes de crearlo, mismo criterio que
 * `generateAuthorizationScript` (CONFIRMADO EN VIVO, 2026-10-30, ONU
 * CMDCDD4D131E): destruir y recrear limpio evita una VLAN vieja de un
 * intento anterior con otra Red TR-069.
 */
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
    'write',
  ];
}

/**
 * Script CLI COMPLETO que ejecutará "Aplicar Perfil TR-069" (Etapa 2) --
 * capa de transporte (`generateTr069TransportScript`, su propia sesión
 * configure-terminal/write) seguida de la capa OMCI
 * (`generateTr069ManagementScript`, otra sesión aparte) -- mismo orden que
 * `applyTr069ManagementWithSession()`. Usado SOLO para la vista previa
 * (dry-run) del botón "Previsualizar Script CLI", igual que
 * `generateAuthorizationScript` para la Etapa 1 -- no incluye los comandos
 * de verificación/creación de perfiles TCONT/Traffic (`ensureTcontProfileWithSession`/
 * `ensureTrafficProfileWithSession`), que dependen de consultar la OLT en
 * vivo y no son parte del script determinista.
 */
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
